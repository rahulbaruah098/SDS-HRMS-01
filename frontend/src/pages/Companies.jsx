import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  CheckCircle2,
  Eye,
  IndianRupee,
  Loader2,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';

import { api } from '../api/client';
import { emptyCompany } from '../data/modules';

const COMPANY_PAGE_SIZE_OPTIONS = [25, 50, 100, 200];
const DEFAULT_COMPANY_PAGE_SIZE = 25;
const FEEDBACK_AUTO_HIDE_MS = 3600;

const DEFAULT_COMPANY_FORM = {
  ...emptyCompany,
  company_name: emptyCompany.name || '',
  company_email: emptyCompany.contact_email || '',
  company_phone: emptyCompany.contact_phone || '',
  tenant_code: '',
  plan_type: 'paid',
  status: 'active',
  employee_limit: '',
};

const STATUS_OPTIONS = [
  { value: '', label: 'All Status' },
  { value: 'active', label: 'Active' },
  { value: 'expired', label: 'Expired' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'pending', label: 'Pending' },
];

const PLAN_OPTIONS = [
  { value: '', label: 'All Plans' },
  { value: 'demo', label: 'Trial' },
  { value: 'paid', label: 'Paid' },
  { value: 'lifetime', label: 'Lifetime' },
];

function safeText(value, fallback = '—') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatDate(value) {
  if (!value) {
    return '—';
  }

  if (typeof value === 'object' && value.$date) {
    value = value.$date;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return safeText(value);
  }

  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatCurrency(value, currency = 'INR') {
  const amount = toNumber(value, 0);

  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currency || 'INR',
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currency || 'INR'} ${amount}`;
  }
}

function statusColor(status) {
  const normalized = String(status || '').toLowerCase();

  if (normalized === 'active' || normalized === 'paid') {
    return {
      background: 'rgba(22, 163, 74, 0.12)',
      color: '#166534',
      border: '1px solid rgba(22, 163, 74, 0.25)',
    };
  }

  if (normalized === 'expired' || normalized === 'rejected') {
    return {
      background: 'rgba(220, 38, 38, 0.12)',
      color: '#991b1b',
      border: '1px solid rgba(220, 38, 38, 0.25)',
    };
  }

  if (normalized === 'suspended' || normalized === 'pending') {
    return {
      background: 'rgba(234, 88, 12, 0.12)',
      color: '#9a3412',
      border: '1px solid rgba(234, 88, 12, 0.25)',
    };
  }

  return {
    background: 'rgba(37, 99, 235, 0.12)',
    color: '#1d4ed8',
    border: '1px solid rgba(37, 99, 235, 0.25)',
  };
}

function badgeText(value) {
  return safeText(value)
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function StatusBadge({ value }) {
  return (
    <span
      style={{
        ...statusColor(value),
        display: 'inline-flex',
        alignItems: 'center',
        borderRadius: 999,
        padding: '5px 10px',
        fontSize: 12,
        fontWeight: 800,
        whiteSpace: 'nowrap',
      }}
    >
      {badgeText(value)}
    </span>
  );
}

function getTenantId(row = {}) {
  return row.tenant_id || row.id || row._id || '';
}

function getCompanyName(row = {}) {
  return row.company_name || row.name || row.tenant_name || 'Company';
}

function getCompanyEmail(row = {}) {
  return row.company_email || row.contact_email || row.email || '';
}

function getEmployeeCount(row = {}) {
  return toNumber(
    row.employee_count ??
      row.employees_count ??
      row.total_employees ??
      row.usage?.employees ??
      0,
    0,
  );
}

function getEmployeeLimit(row = {}) {
  const limit = row.employee_limit ?? row.usage?.employee_limit ?? '';

  if (limit === null || limit === undefined || limit === '') {
    return 'Unlimited';
  }

  return String(limit);
}

function SummaryCard({ icon: Icon, label, value, tone = '#2563eb' }) {
  return (
    <div
      className="stat-card"
      style={{
        padding: 18,
        border: '1px solid rgba(226,232,240,0.9)',
        minHeight: 116,
      }}
    >
      <div
        style={{
          width: 42,
          height: 42,
          borderRadius: 16,
          display: 'grid',
          placeItems: 'center',
          background: `${tone}18`,
          color: tone,
          marginBottom: 10,
        }}
      >
        <Icon size={22} />
      </div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CompanyActionDialog({
  dialog,
  form,
  setForm,
  error,
  onClose,
  onSubmit,
}) {
  if (!dialog || typeof document === 'undefined') {
    return null;
  }

  const isSuspend = dialog.type === 'suspend';
  const isExtendDemo = dialog.type === 'extend-demo';
  const isMarkPaid = dialog.type === 'mark-paid';

  const title = isSuspend
    ? 'Deactivate Company'
    : isExtendDemo
      ? 'Extend Trial'
      : 'Mark Company as Paid';

  const description = isSuspend
    ? 'Add the reason for deactivating this company. The company can be activated again later.'
    : isExtendDemo
      ? 'Enter the number of additional trial days and the reason for this extension.'
      : 'Enter the payment amount, subscription duration, and a short note for this paid activation.';

  const confirmLabel = isSuspend
    ? 'Deactivate Company'
    : isExtendDemo
      ? 'Extend Trial'
      : 'Mark Paid';

  return createPortal(
    <div
      className="company-action-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <form
        className="company-action-dialog"
        onSubmit={onSubmit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="company-action-dialog-header">
          <div>
            <span className="company-action-dialog-kicker">Company Action</span>
            <h2>{title}</h2>
            <p>
              {dialog.companyName}
              <span aria-hidden="true"> · </span>
              {description}
            </p>
          </div>

          <button
            type="button"
            className="company-action-dialog-close"
            onClick={onClose}
            aria-label="Close action window"
          >
            <X size={17} />
          </button>
        </header>

        <div className="company-action-dialog-body">
          {isSuspend ? (
            <label className="company-action-field">
              <span>Suspension reason</span>
              <textarea
                value={form.reason ?? ''}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    reason: event.target.value,
                  }))
                }
                rows={4}
                autoFocus
              />
            </label>
          ) : null}

          {isExtendDemo ? (
            <>
              <label className="company-action-field">
                <span>Extend trial by (days)</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={form.days ?? ''}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      days: event.target.value,
                    }))
                  }
                  autoFocus
                />
              </label>

              <label className="company-action-field">
                <span>Reason for trial extension</span>
                <textarea
                  value={form.reason ?? ''}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      reason: event.target.value,
                    }))
                  }
                  rows={4}
                />
              </label>
            </>
          ) : null}

          {isMarkPaid ? (
            <>
              <div className="company-action-field-grid">
                <label className="company-action-field">
                  <span>Paid amount</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.amount ?? ''}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        amount: event.target.value,
                      }))
                    }
                    autoFocus
                  />
                </label>

                <label className="company-action-field">
                  <span>Subscription duration (days)</span>
                  <input
                    type="number"
                    step="1"
                    value={form.durationDays ?? ''}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        durationDays: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>

              <label className="company-action-field">
                <span>Reason / note</span>
                <textarea
                  value={form.reason ?? ''}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      reason: event.target.value,
                    }))
                  }
                  rows={4}
                />
              </label>
            </>
          ) : null}

          {error ? (
            <div className="company-action-dialog-error" role="alert">
              <AlertTriangle size={16} />
              <span>{error}</span>
            </div>
          ) : null}
        </div>

        <footer className="company-action-dialog-footer">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>

          <button
            type="submit"
            className={`company-action-dialog-confirm ${isSuspend ? 'danger' : 'primary'}`}
          >
            {isSuspend ? <PauseCircle size={16} /> : null}
            {isExtendDemo ? <CalendarClock size={16} /> : null}
            {isMarkPaid ? <IndianRupee size={16} /> : null}
            {confirmLabel}
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  );
}

function DetailModal({
  detail,
  loading,
  onClose,
  onActivate,
  onSuspend,
  onExtendDemo,
  onMarkPaid,
  onDismissActionFeedback,
  actionFeedback,
  actionBusy,
}) {
  if (!detail || typeof document === 'undefined') {
    return null;
  }

  const item = detail.item || detail;
  const tenantId = getTenantId(item);
  const payments = detail.payments || [];
  const subscriptions = detail.subscriptions || [];
  const demoRequest = detail.demo_request || null;
  const isSds =
    item.is_sds_company === true ||
    String(item.tenant_code || '').toLowerCase() === 'sds';
  const normalizedStatus = String(item.status || '').toLowerCase();
  const isActive = normalizedStatus === 'active';
  const isDeactivated = normalizedStatus === 'suspended';

  return createPortal(
    <div
      className="company-detail-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`Company details for ${getCompanyName(item)}`}
    >
      <div className="company-detail-modal">
        <header className="company-detail-header">
          <div className="company-detail-heading">
            <span className="company-detail-kicker">Company Detail</span>

            <div className="company-detail-title-row">
              <div>
                <h2>{getCompanyName(item)}</h2>
                <p>
                  {safeText(getCompanyEmail(item))}
                  <span aria-hidden="true"> · </span>
                  Tenant ID: {safeText(tenantId)}
                </p>
              </div>

              <StatusBadge value={item.status || '—'} />
            </div>
          </div>

          <button
            type="button"
            className="company-detail-close"
            onClick={onClose}
            aria-label="Close company detail"
          >
            <X size={17} />
            <span>Close</span>
          </button>
        </header>

        {loading ? (
          <div className="company-detail-loading">
            <Loader2 size={20} className="spin" />
            <span>Loading company detail...</span>
          </div>
        ) : (
          <div className="company-detail-body">
            <section className="company-detail-kpis" aria-label="Company summary">
              <SummaryCard
                icon={ShieldCheck}
                label="Plan"
                value={badgeText(item.plan_type || item.plan || '—')}
                tone="#2563eb"
              />
              <SummaryCard
                icon={CheckCircle2}
                label="Status"
                value={badgeText(item.status || '—')}
                tone="#16a34a"
              />
              <SummaryCard
                icon={Users}
                label="Employees"
                value={`${getEmployeeCount(item)} / ${getEmployeeLimit(item)}`}
                tone="#7c3aed"
              />
              <SummaryCard
                icon={CalendarClock}
                label="Trial Ends"
                value={formatDate(item.trial_end_date || item.subscription_end_date)}
                tone="#ea580c"
              />
            </section>

            <section className="company-modal-action-area" aria-label="Company actions">
              <div className="company-modal-action-heading">
                <div>
                  <span>Account controls</span>
                  <strong>Manage current company status</strong>
                </div>
                <StatusBadge value={item.status || '—'} />
              </div>

              <div className="company-modal-actions">
                <button
                  type="button"
                  className={`company-status-action activate ${isActive ? 'is-current' : ''}`}
                  onClick={() => onActivate(tenantId)}
                  disabled={loading || Boolean(actionBusy) || isActive}
                >
                  {actionBusy === 'activate' ? (
                    <Loader2 size={16} className="spin" />
                  ) : isActive ? (
                    <CheckCircle2 size={16} />
                  ) : (
                    <PlayCircle size={16} />
                  )}
                  {isActive ? 'Active' : 'Activate'}
                </button>

                <button
                  type="button"
                  className={`company-status-action deactivate ${isDeactivated ? 'is-current' : ''}`}
                  onClick={() => onSuspend(tenantId)}
                  disabled={loading || Boolean(actionBusy) || isSds || isDeactivated}
                >
                  {actionBusy === 'suspend' ? (
                    <Loader2 size={16} className="spin" />
                  ) : (
                    <PauseCircle size={16} />
                  )}
                  {isDeactivated ? 'Deactivated' : 'Deactivate'}
                </button>

                <button
                  type="button"
                  className="ghost"
                  onClick={() => onExtendDemo(tenantId)}
                  disabled={loading || Boolean(actionBusy) || item.plan_type !== 'demo'}
                >
                  {actionBusy === 'extend-demo' ? (
                    <Loader2 size={16} className="spin" />
                  ) : (
                    <CalendarClock size={16} />
                  )}
                  Extend Trial
                </button>

                <button
                  type="button"
                  className="ghost"
                  onClick={() => onMarkPaid(tenantId)}
                  disabled={loading || Boolean(actionBusy) || item.plan_type === 'lifetime'}
                >
                  {actionBusy === 'mark-paid' ? (
                    <Loader2 size={16} className="spin" />
                  ) : (
                    <IndianRupee size={16} />
                  )}
                  Mark Paid
                </button>
              </div>

              {actionFeedback ? (
                <div
                  className={`company-action-feedback ${actionFeedback.type || 'success'}`}
                  role="status"
                >
                  {actionFeedback.type === 'error' ? (
                    <AlertTriangle size={16} />
                  ) : (
                    <CheckCircle2 size={16} />
                  )}
                  <span>{actionFeedback.text}</span>
                  <button
                    type="button"
                    className="company-feedback-close"
                    onClick={onDismissActionFeedback}
                    aria-label="Dismiss message"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : null}
            </section>

            {isSds ? (
              <div className="company-protection-note">
                <ShieldCheck size={19} />
                <p>
                  SDS is protected as the lifetime full-access company. It cannot be
                  suspended and does not require payment.
                </p>
              </div>
            ) : null}

            <section className="company-detail-grid">
              <article className="company-detail-card">
                <div className="company-detail-card-heading">
                  <Building2 size={17} />
                  <div>
                    <span>Profile</span>
                    <h3>Company Information</h3>
                  </div>
                </div>

                <dl className="company-detail-list">
                  <div>
                    <dt>Tenant Code</dt>
                    <dd>{safeText(item.tenant_code)}</dd>
                  </div>
                  <div>
                    <dt>Phone</dt>
                    <dd>{safeText(item.company_phone || item.contact_phone)}</dd>
                  </div>
                  <div>
                    <dt>Address</dt>
                    <dd>{safeText(item.address)}</dd>
                  </div>
                  <div>
                    <dt>Allowed Modules</dt>
                    <dd>
                      {Array.isArray(item.allowed_modules)
                        ? item.allowed_modules.join(', ')
                        : safeText(item.allowed_modules)}
                    </dd>
                  </div>
                </dl>
              </article>

              <article className="company-detail-card">
                <div className="company-detail-card-heading">
                  <CalendarClock size={17} />
                  <div>
                    <span>Trial access</span>
                    <h3>Trial Request</h3>
                  </div>
                </div>

                {demoRequest ? (
                  <dl className="company-detail-list">
                    <div>
                      <dt>Status</dt>
                      <dd>{safeText(demoRequest.status)}</dd>
                    </div>
                    <div>
                      <dt>OTP Verified</dt>
                      <dd>{demoRequest.otp_verified ? 'Yes' : 'No'}</dd>
                    </div>
                    <div>
                      <dt>Requested</dt>
                      <dd>{formatDate(demoRequest.created_at || demoRequest.requested_at)}</dd>
                    </div>
                    <div>
                      <dt>Approved</dt>
                      <dd>{formatDate(demoRequest.approved_at)}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="company-detail-empty">No linked trial request found.</p>
                )}
              </article>
            </section>

            <section className="company-detail-history-grid">
              <article className="company-detail-history-card">
                <div className="company-detail-card-heading">
                  <ShieldCheck size={17} />
                  <div>
                    <span>History</span>
                    <h3>Recent Subscriptions</h3>
                  </div>
                </div>

                {subscriptions.length ? (
                  <div className="company-history-list">
                    {subscriptions.slice(0, 5).map((subscription) => (
                      <div
                        className="company-history-item"
                        key={subscription._id || subscription.id}
                      >
                        <strong>
                          {safeText(subscription.plan_name || subscription.plan_type)}
                        </strong>
                        <span>
                          {safeText(subscription.status)}
                          <span aria-hidden="true"> · </span>
                          {formatDate(subscription.start_date || subscription.created_at)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="company-detail-empty">No subscription records found.</p>
                )}
              </article>

              <article className="company-detail-history-card">
                <div className="company-detail-card-heading">
                  <IndianRupee size={17} />
                  <div>
                    <span>Payments</span>
                    <h3>Recent Payments</h3>
                  </div>
                </div>

                {payments.length ? (
                  <div className="company-history-list">
                    {payments.slice(0, 5).map((payment) => (
                      <div
                        className="company-history-item"
                        key={payment._id || payment.id}
                      >
                        <strong>
                          {formatCurrency(payment.amount, payment.currency || 'INR')}
                        </strong>
                        <span>
                          {safeText(payment.payment_status || payment.status)}
                          <span aria-hidden="true"> · </span>
                          {formatDate(payment.paid_at || payment.created_at)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="company-detail-empty">No payment records found.</p>
                )}
              </article>
            </section>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// SaaS companies page uses 15-day full-access trial display wording.
export default function Companies() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [form, setForm] = useState(DEFAULT_COMPANY_FORM);
  const [filters, setFilters] = useState({
    q: '',
    status: '',
    plan_type: '',
  });
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [searchFeedback, setSearchFeedback] = useState(null);
  const [actionFeedback, setActionFeedback] = useState({});
  const [actionBusy, setActionBusy] = useState({});
  const [actionDialog, setActionDialog] = useState(null);
  const [actionDialogForm, setActionDialogForm] = useState({});
  const [actionDialogError, setActionDialogError] = useState('');
  const [tableSearch, setTableSearch] = useState('');
  const [tablePage, setTablePage] = useState(1);
  const [tablePageSize, setTablePageSize] = useState(DEFAULT_COMPANY_PAGE_SIZE);

  const queryString = useMemo(() => {
    const query = new URLSearchParams();

    if (filters.q) {
      query.append('q', filters.q);
    }

    if (filters.status) {
      query.append('status', filters.status);
    }

    if (filters.plan_type) {
      query.append('plan_type', filters.plan_type);
    }

    const text = query.toString();
    return text ? `?${text}` : '';
  }, [filters]);

  async function load(options = {}) {
    const showSearchFeedback = options?.showSearchFeedback === true;

    setLoading(true);
    setMessage('');

    if (showSearchFeedback) {
      setSearchFeedback({
        type: 'info',
        text: 'Searching companies...',
      });
    }

    try {
      const data = await api(`/superadmin/companies${queryString}`);
      const items = data.items || [];

      setRows(items);
      setSummary(data.summary || {});

      if (showSearchFeedback) {
        setSearchFeedback({
          type: 'success',
          text: `Search complete — ${items.length} ${items.length === 1 ? 'company' : 'companies'} found.`,
        });
      }
    } catch (error) {
      const errorMessage = error.message || 'Unable to load companies.';

      if (showSearchFeedback) {
        setSearchFeedback({
          type: 'error',
          text: errorMessage,
        });
      } else {
        setMessage(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!searchFeedback) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setSearchFeedback(null);
    }, FEEDBACK_AUTO_HIDE_MS);

    return () => window.clearTimeout(timer);
  }, [searchFeedback]);

  useEffect(() => {
    const activeTenantIds = Object.keys(actionFeedback).filter(
      (tenantId) => Boolean(actionFeedback[tenantId]),
    );

    if (!activeTenantIds.length) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setActionFeedback((prev) => {
        const next = { ...prev };

        activeTenantIds.forEach((tenantId) => {
          delete next[tenantId];
        });

        return next;
      });
    }, FEEDBACK_AUTO_HIDE_MS);

    return () => window.clearTimeout(timer);
  }, [actionFeedback]);

  useEffect(() => {
    const hasActionFeedback = Object.values(actionFeedback).some(Boolean);

    if (!searchFeedback && !hasActionFeedback) {
      return undefined;
    }

    const dismissFeedback = () => {
      setSearchFeedback(null);
      setActionFeedback({});
    };

    const dismissOnEscape = (event) => {
      if (event.key === 'Escape') {
        dismissFeedback();
      }
    };

    window.addEventListener('click', dismissFeedback);
    window.addEventListener('keydown', dismissOnEscape);

    return () => {
      window.removeEventListener('click', dismissFeedback);
      window.removeEventListener('keydown', dismissOnEscape);
    };
  }, [searchFeedback, actionFeedback]);

  useEffect(() => {
    if ((!detail && !actionDialog) || typeof document === 'undefined') {
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
      const activeModal = actionDialog
        ? document.querySelector('.company-action-dialog')
        : document.querySelector('.company-detail-modal');

      if (activeModal && activeModal.contains(event.target)) {
        return;
      }

      event.preventDefault();
    };

    document.addEventListener('wheel', blockBackgroundScroll, { passive: false });
    document.addEventListener('touchmove', blockBackgroundScroll, { passive: false });

    return () => {
      document.removeEventListener('wheel', blockBackgroundScroll);
      document.removeEventListener('touchmove', blockBackgroundScroll);

      body.style.overflow = previousBodyOverflow;
      root.style.overflow = previousRootOverflow;
      body.style.overscrollBehavior = previousBodyOverscroll;
      root.style.overscrollBehavior = previousRootOverscroll;
    };
  }, [detail, actionDialog]);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setMessage('');

    try {
      const payload = {
        ...form,
        name: form.name || form.company_name,
        company_name: form.company_name || form.name,
        contact_email: form.contact_email || form.company_email,
        company_email: form.company_email || form.contact_email,
        contact_phone: form.contact_phone || form.company_phone,
        company_phone: form.company_phone || form.contact_phone,
      };

      const data = await api('/superadmin/companies', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setMessage(data.message || 'Company created successfully.');
      setForm(DEFAULT_COMPANY_FORM);
      await load();
    } catch (error) {
      setMessage(error.message || 'Unable to create company.');
    } finally {
      setSaving(false);
    }
  }

  async function openDetail(tenantId) {
    if (!tenantId) {
      return;
    }

    setSelectedTenantId(tenantId);
    setDetailLoading(true);
    setDetail({ item: { tenant_id: tenantId } });

    try {
      const data = await api(`/superadmin/companies/${encodeURIComponent(tenantId)}`);
      setDetail(data);
    } catch (error) {
      setMessage(error.message || 'Unable to load company detail.');
      setDetail(null);
      setSelectedTenantId('');
    } finally {
      setDetailLoading(false);
    }
  }

  async function runCompanyAction(tenantId, action, payload = {}) {
    if (!tenantId || !action) {
      return;
    }

    const currentRow = rows.find((row) => getTenantId(row) === tenantId);
    const currentDetailItem = detail?.item || detail || {};
    const companyName = getCompanyName(currentRow || currentDetailItem);

    setMessage('');
    setActionBusy((prev) => ({
      ...prev,
      [tenantId]: action,
    }));
    setActionFeedback((prev) => ({
      ...prev,
      [tenantId]: null,
    }));

    try {
      const data = await api(`/superadmin/companies/${encodeURIComponent(tenantId)}/${action}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      const serverItem =
        data?.item ||
        data?.company ||
        data?.tenant ||
        data?.updated_company ||
        data?.data?.item ||
        data?.data?.company ||
        data?.data?.tenant ||
        {};

      const fallbackPatch = {};

      if (action === 'activate') {
        fallbackPatch.status = 'active';
      } else if (action === 'suspend') {
        fallbackPatch.status = 'suspended';
      } else if (action === 'mark-paid') {
        fallbackPatch.status = 'active';
        fallbackPatch.plan_type = 'paid';
      }

      const updatedCompany = {
        ...fallbackPatch,
        ...(serverItem && typeof serverItem === 'object' && !Array.isArray(serverItem)
          ? serverItem
          : {}),
      };

      setRows((prevRows) =>
        prevRows.map((row) =>
          getTenantId(row) === tenantId
            ? {
                ...row,
                ...updatedCompany,
              }
            : row,
        ),
      );

      setDetail((prevDetail) => {
        if (!prevDetail) {
          return prevDetail;
        }

        const previousItem = prevDetail.item || prevDetail;

        if (getTenantId(previousItem) !== tenantId) {
          return prevDetail;
        }

        if (prevDetail.item) {
          return {
            ...prevDetail,
            ...(data && typeof data === 'object' ? data : {}),
            item: {
              ...previousItem,
              ...updatedCompany,
            },
          };
        }

        return {
          ...previousItem,
          ...updatedCompany,
        };
      });

      const successText =
        action === 'activate'
          ? `${companyName} is active now.`
          : action === 'suspend'
            ? `${companyName} is deactivated now.`
            : action === 'extend-demo'
              ? `Trial access for ${companyName} was extended successfully.`
              : action === 'mark-paid'
                ? `${companyName} was marked as paid and activated successfully.`
                : data.message || 'Company updated successfully.';

      setActionFeedback((prev) => ({
        ...prev,
        [tenantId]: {
          type: 'success',
          text: successText,
        },
      }));
    } catch (error) {
      setActionFeedback((prev) => ({
        ...prev,
        [tenantId]: {
          type: 'error',
          text: error.message || 'Unable to update company.',
        },
      }));
    } finally {
      setActionBusy((prev) => {
        const next = { ...prev };
        delete next[tenantId];
        return next;
      });
    }
  }

  function openActionDialog(type, tenantId) {
    if (!tenantId) {
      return;
    }

    const currentRow = rows.find((row) => getTenantId(row) === tenantId);
    const currentDetailItem = detail?.item || detail || {};
    const companyName = getCompanyName(currentRow || currentDetailItem);

    const defaults =
      type === 'suspend'
        ? {
            reason: 'Subscription or admin decision',
          }
        : type === 'extend-demo'
          ? {
              days: '7',
              reason: 'Superadmin approved trial extension',
            }
          : {
              amount: '4999',
              durationDays: '30',
              reason: 'Manual paid activation by Superadmin',
            };

    setActionDialog({
      type,
      tenantId,
      companyName,
    });
    setActionDialogForm(defaults);
    setActionDialogError('');
  }

  function closeActionDialog() {
    setActionDialog(null);
    setActionDialogForm({});
    setActionDialogError('');
  }

  function handleSuspend(tenantId) {
    openActionDialog('suspend', tenantId);
  }

  function handleExtendDemo(tenantId) {
    openActionDialog('extend-demo', tenantId);
  }

  function handleMarkPaid(tenantId) {
    openActionDialog('mark-paid', tenantId);
  }

  function submitActionDialog(event) {
    event.preventDefault();

    if (!actionDialog?.tenantId) {
      return;
    }

    const tenantId = actionDialog.tenantId;

    if (actionDialog.type === 'suspend') {
      const reason = String(actionDialogForm.reason ?? '');

      closeActionDialog();
      runCompanyAction(tenantId, 'suspend', { reason });
      return;
    }

    if (actionDialog.type === 'extend-demo') {
      const days = Number(actionDialogForm.days);

      if (!Number.isFinite(days) || days <= 0) {
        setActionDialogError('Please enter a valid number of days.');
        return;
      }

      const reason = String(actionDialogForm.reason ?? '');

      closeActionDialog();
      runCompanyAction(tenantId, 'extend-demo', {
        days,
        reason,
      });
      return;
    }

    if (actionDialog.type === 'mark-paid') {
      const amount = Number(actionDialogForm.amount);

      if (!Number.isFinite(amount) || amount < 0) {
        setActionDialogError('Please enter a valid payment amount.');
        return;
      }

      const durationDays = Number(actionDialogForm.durationDays);

      if (!Number.isFinite(durationDays)) {
        setActionDialogError('Please enter a valid subscription duration.');
        return;
      }

      const reason = String(actionDialogForm.reason ?? '');

      closeActionDialog();
      runCompanyAction(tenantId, 'mark-paid', {
        amount,
        duration_days: durationDays,
        reason,
      });
    }
  }

  function handleChange(key, value) {
    setForm((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  const tableSearchText = tableSearch.trim().toLowerCase();

  const filteredCompanyRows = tableSearchText
    ? rows.filter((row) => {
        const tenantId = getTenantId(row);
        const searchableValues = [
          getCompanyName(row),
          getCompanyEmail(row),
          tenantId,
          row.tenant_code,
          row.plan_type || row.plan,
          row.status,
          getEmployeeCount(row),
          getEmployeeLimit(row),
          formatDate(row.trial_end_date || row.subscription_end_date),
        ];

        return searchableValues.some((value) =>
          String(value ?? '').toLowerCase().includes(tableSearchText),
        );
      })
    : rows;

  const companyPageCount = Math.max(
    1,
    Math.ceil(filteredCompanyRows.length / tablePageSize),
  );

  const currentCompanyPage = Math.min(tablePage, companyPageCount);
  const companyStartIndex = (currentCompanyPage - 1) * tablePageSize;
  const visibleCompanyRows = filteredCompanyRows.slice(
    companyStartIndex,
    companyStartIndex + tablePageSize,
  );

  const companyPageNumbers = (() => {
    if (companyPageCount <= 7) {
      return Array.from({ length: companyPageCount }, (_, index) => index + 1);
    }

    const pageNumbers = [1];
    const startPage = Math.max(2, currentCompanyPage - 1);
    const endPage = Math.min(companyPageCount - 1, currentCompanyPage + 1);

    if (startPage > 2) {
      pageNumbers.push('left-ellipsis');
    }

    for (let pageNumber = startPage; pageNumber <= endPage; pageNumber += 1) {
      pageNumbers.push(pageNumber);
    }

    if (endPage < companyPageCount - 1) {
      pageNumbers.push('right-ellipsis');
    }

    pageNumbers.push(companyPageCount);
    return pageNumbers;
  })();

  return (
    <div className="page-grid companies-control-page">

      <style>{`
        .companies-control-page {
          --company-ink: #101a3a;
          --company-muted: #5d6d8d;
          --company-primary: #6658dc;
          --company-deep: #342b78;
          --company-cyan: #18b5c8;
          --company-teal: #34c9c4;
          --company-danger: #d84d68;
          --company-line: rgba(16, 26, 58, .14);
          --company-ease: cubic-bezier(.22, 1, .36, 1);

          display: grid;
          gap: clamp(18px, 2vw, 26px);
          width: 100%;
          min-width: 0;
          max-width: 100%;
          padding-bottom: max(34px, env(safe-area-inset-bottom));
          color: var(--company-ink);
          font-family: var(--yc-ui, var(--body), inherit);
        }

        .companies-control-page *,
        .companies-control-page *::before,
        .companies-control-page *::after {
          box-sizing: border-box;
        }

        .companies-control-page > *,
        .companies-control-page .panel,
        .companies-control-page .toolbar,
        .companies-control-page .dynamic-form,
        .companies-control-page .company-table-tools,
        .companies-control-page .company-data-board,
        .companies-control-page .company-table-footer {
          width: 100%;
          min-width: 0;
          max-width: 100%;
        }

        .companies-control-page img,
        .companies-control-page input,
        .companies-control-page select,
        .companies-control-page button {
          max-width: 100%;
        }

        .companies-control-page > .hero {
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

        .companies-control-page > .hero::before,
        .companies-control-page > .hero::after {
          content: none;
          display: none;
        }

        .companies-control-page > .hero > div {
          min-width: 0;
          max-width: 930px;
        }

        .companies-control-page .kicker {
          display: inline-flex;
          align-items: center;
          width: fit-content;
          max-width: 100%;
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

        .companies-control-page > .hero h1 {
          margin: 15px 0 10px;
          color: var(--company-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(42px, 5vw, 74px);
          font-weight: 760;
          line-height: .94;
          letter-spacing: -.056em;
          overflow-wrap: anywhere;
        }

        .companies-control-page > .hero p {
          max-width: 860px;
          margin: 0;
          color: var(--company-muted);
          font-size: clamp(13px, 1vw, 16px);
          line-height: 1.68;
        }

        .companies-control-page > .panel {
          overflow: hidden;
          padding: 24px;
          border: 1px solid rgba(171, 181, 211, .70);
          border-radius: clamp(26px, 2.2vw, 36px);
          background: linear-gradient(145deg, #ffffff, #f7fbff);
          box-shadow:
            8px 10px 0 #c4ccff,
            0 24px 42px rgba(34, 38, 110, .10);
        }

        .companies-control-page > .panel > div:first-child {
          margin-bottom: 24px !important;
        }

        .companies-control-page .stat-card {
          border: 1px solid rgba(171, 181, 211, .64) !important;
          border-radius: 22px !important;
          background: #edf6ff !important;
          box-shadow:
            7px 9px 0 #b9d7ff,
            0 18px 30px rgba(34, 38, 110, .08) !important;
          transition:
            transform 190ms var(--company-ease),
            box-shadow 190ms ease !important;
        }

        .companies-control-page .stat-card:nth-child(2) {
          background: #eaf8f4 !important;
          box-shadow:
            7px 9px 0 #aee6d9,
            0 18px 30px rgba(34, 38, 110, .08) !important;
        }

        .companies-control-page .stat-card:nth-child(3) {
          background: #fff4d5 !important;
          box-shadow:
            7px 9px 0 #ffe0a5,
            0 18px 30px rgba(34, 38, 110, .08) !important;
        }

        .companies-control-page .stat-card:nth-child(4),
        .companies-control-page .stat-card:nth-child(5) {
          background: #f1efff !important;
          box-shadow:
            7px 9px 0 #c9c0ff,
            0 18px 30px rgba(34, 38, 110, .08) !important;
        }

        .companies-control-page .stat-card:hover {
          transform: translateY(-3px);
        }

        .companies-control-page button {
          touch-action: manipulation;
          font: inherit;
          font-weight: 900;
          cursor: pointer;
          transition:
            transform 190ms var(--company-ease),
            box-shadow 190ms ease,
            background 190ms ease,
            border-color 190ms ease,
            color 190ms ease,
            filter 190ms ease;
        }

        .companies-control-page button:hover:not(:disabled) {
          transform: translateY(-2px);
          filter: saturate(1.04);
        }

        .companies-control-page button:active:not(:disabled) {
          transform: translateY(0) scale(.985);
        }

        .companies-control-page button:disabled {
          cursor: not-allowed;
          opacity: .52;
          transform: none;
          filter: none;
        }

        .companies-control-page .primary,
        .companies-control-page .ghost {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-height: 45px;
          padding: 0 15px;
          border-radius: 14px;
          line-height: 1;
          white-space: nowrap;
        }

        .companies-control-page .primary:not(.company-target-search-button):not(.company-target-create-button) {
          border: 1px solid rgba(52, 43, 120, .16);
          color: #fff;
          background: linear-gradient(135deg, #342b78, #4f65d7 58%, #18b5c8);
          box-shadow:
            5px 6px 0 #a9d6f5,
            0 14px 25px rgba(36, 74, 128, .16);
        }

        .companies-control-page .company-target-search-button,
        .companies-control-page .company-target-create-button {
          border: 1px solid rgba(76, 118, 220, .18);
          color: #fff;
          background: linear-gradient(135deg, #4c76dc 0%, #2db6b7 100%);
          box-shadow:
            6px 7px 0 #595192,
            0 14px 25px rgba(67, 116, 170, .16);
        }

        .companies-control-page .ghost {
          border: 1px solid rgba(65, 55, 161, .18);
          color: #40348d;
          background: rgba(255, 255, 255, .94);
          box-shadow: 3px 4px 0 rgba(52, 43, 120, .10);
        }

        .companies-control-page .toolbar {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: nowrap;
          padding: 17px;
          border: 1px solid rgba(102, 88, 220, .12);
          border-radius: 20px;
          background: linear-gradient(145deg, rgba(237, 248, 255, .64), rgba(248, 241, 255, .52));
        }

        .companies-control-page .toolbar .search {
          flex: 1 1 auto !important;
          min-width: 260px;
        }

        .companies-control-page .toolbar > .primary {
          flex: 0 0 auto;
        }

        .companies-control-page .company-search-action {
          position: relative;
          flex: 0 0 auto;
          min-width: 0;
        }

        .companies-control-page .company-search-action > .primary {
          width: 100%;
        }

        .companies-control-page .company-search-feedback {
          position: absolute;
          z-index: 30;
          top: calc(100% + 9px);
          right: 0;
          display: flex;
          align-items: flex-start;
          gap: 8px;
          width: max-content;
          max-width: min(340px, 82vw);
          padding: 11px 13px;
          border: 1px solid rgba(102,88,220,.18);
          border-radius: 13px;
          color: #40348d;
          background: #f1efff;
          box-shadow: 4px 5px 0 #c9c0ff, 0 16px 30px rgba(34,38,110,.12);
          font-size: 11px;
          font-weight: 850;
          line-height: 1.45;
        }

        .companies-control-page .company-search-feedback svg {
          flex: 0 0 auto;
          margin-top: 1px;
        }

        .companies-control-page .company-search-feedback > span {
          min-width: 0;
          flex: 1 1 auto;
        }

        .companies-control-page .company-search-feedback.success {
          border-color: rgba(4,120,87,.20);
          color: #047857;
          background: #eaf8f4;
          box-shadow: 4px 5px 0 #aee6d9, 0 16px 30px rgba(34,38,110,.10);
        }

        .companies-control-page .company-search-feedback.error {
          border-color: rgba(162,52,77,.20);
          color: #a2344d;
          background: #fff0f2;
          box-shadow: 4px 5px 0 #f2c2cc, 0 16px 30px rgba(34,38,110,.10);
        }

        .companies-control-page .search {
          position: relative;
          display: flex;
          align-items: center;
          min-width: 0;
          min-height: 46px;
          overflow: hidden;
          border: 1px solid rgba(151, 161, 197, .58);
          border-radius: 15px;
          background: #fff;
        }

        .companies-control-page .search > svg {
          margin-left: 14px;
          flex: 0 0 auto;
          color: var(--company-primary);
        }

        .companies-control-page .search input {
          width: 100%;
          min-width: 0;
          min-height: 44px;
          padding: 0 13px 0 10px;
          border: 0;
          outline: 0;
          color: var(--company-ink);
          background: transparent;
          font: inherit;
          font-weight: 650;
        }

        .companies-control-page .dynamic-form input,
        .companies-control-page .dynamic-form select,
        .companies-control-page .company-table-search input,
        .companies-control-page .company-page-size select {
          width: 100%;
          min-width: 0;
          min-height: 46px;
          padding: 0 13px;
          border: 1px solid rgba(151, 161, 197, .58);
          border-radius: 14px;
          outline: 0;
          color: var(--company-ink);
          background: rgba(255,255,255,.96);
          font: inherit;
          font-weight: 650;
          transition:
            border-color 170ms ease,
            box-shadow 170ms ease,
            transform 170ms ease;
        }

        .companies-control-page .toolbar > select {
          flex: 0 0 165px;
          width: 165px;
          min-width: 150px;
          max-width: 180px;
          min-height: 46px;
          padding: 0 34px 0 12px;
          border: 1px solid rgba(151, 161, 197, .58);
          border-radius: 14px;
          outline: 0;
          color: var(--company-ink);
          background: rgba(255,255,255,.96);
          font: inherit;
          font-weight: 650;
          transition:
            border-color 170ms ease,
            box-shadow 170ms ease,
            transform 170ms ease;
        }

        .companies-control-page .toolbar > select:focus,
        .companies-control-page .dynamic-form input:focus,
        .companies-control-page .dynamic-form select:focus,
        .companies-control-page .company-table-search input:focus,
        .companies-control-page .company-page-size select:focus {
          border-color: rgba(102,88,220,.65);
          box-shadow:
            4px 5px 0 rgba(102,88,220,.14),
            0 0 0 4px rgba(102,88,220,.08);
          transform: translateY(-1px);
        }

        .companies-control-page .dynamic-form {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
          margin-top: 20px;
          padding: 20px;
          border: 1px solid rgba(102, 88, 220, .11);
          border-radius: 22px;
          background: linear-gradient(145deg, rgba(237,248,255,.52), rgba(248,241,255,.42));
        }

        .companies-control-page .dynamic-form label {
          display: grid;
          gap: 8px;
          min-width: 0;
          margin: 0;
          color: #303b5b;
          font-size: 11px;
          font-weight: 900;
        }

        .companies-control-page .dynamic-form > button {
          align-self: end;
        }

        .companies-control-page .inline-message {
          margin-top: 16px;
          padding: 14px 16px !important;
          border: 1px solid rgba(102,88,220,.18) !important;
          border-radius: 15px !important;
          color: #40348d !important;
          background: #f1efff !important;
          box-shadow: 3px 4px 0 #c9c0ff;
          font-size: 12px;
          font-weight: 850;
        }

        .companies-control-page .company-table-tools {
          display: grid;
          grid-template-columns: minmax(280px, 1fr) auto auto;
          gap: 16px;
          align-items: end;
          margin-top: 24px;
          padding: 18px 20px;
          border: 1px solid rgba(171,181,211,.52);
          border-radius: 20px 20px 0 0;
          background: rgba(248,250,255,.84);
        }

        .companies-control-page .company-table-search {
          position: relative;
          min-width: 0;
        }

        .companies-control-page .company-table-search > svg {
          position: absolute;
          top: 50%;
          left: 14px;
          transform: translateY(-50%);
          color: var(--company-primary);
          pointer-events: none;
        }

        .companies-control-page .company-table-search input {
          padding-left: 43px;
          background: #fff;
        }

        .companies-control-page .company-table-summary {
          display: flex;
          align-items: baseline;
          gap: 6px;
          min-height: 46px;
          padding: 0 4px;
          white-space: nowrap;
        }

        .companies-control-page .company-table-summary strong {
          color: var(--company-ink);
          font-family: Georgia, "Times New Roman", serif;
          font-size: 27px;
          line-height: 1;
        }

        .companies-control-page .company-table-summary span {
          color: var(--company-muted);
          font-size: 11px;
          font-weight: 850;
        }

        .companies-control-page .company-page-size {
          display: grid;
          grid-template-columns: auto 86px;
          align-items: center;
          gap: 8px;
          min-width: 0;
          color: var(--company-muted);
          font-size: 10px;
          font-weight: 900;
          white-space: nowrap;
        }

        .companies-control-page .company-page-size select {
          min-height: 42px;
          padding: 0 30px 0 11px;
          color: #40348d;
          font-weight: 900;
        }

        .companies-control-page .company-data-board {
          display: grid;
          gap: 15px;
          min-width: 0;
          padding: 18px 20px 22px;
          border-right: 1px solid rgba(171,181,211,.52);
          border-left: 1px solid rgba(171,181,211,.52);
          background: linear-gradient(180deg, rgba(255,255,255,.96), rgba(247,250,255,.86));
        }

        .companies-control-page .company-record-card {
          display: grid;
          overflow: hidden;
          min-width: 0;
          border: 1px solid rgba(171,181,211,.58);
          border-radius: 22px;
          background: #fff;
          box-shadow:
            5px 6px 0 rgba(196,204,255,.78),
            0 16px 30px rgba(34,38,110,.07);
          transition:
            transform 190ms var(--company-ease),
            box-shadow 190ms ease,
            border-color 190ms ease;
        }

        .companies-control-page .company-record-card:hover {
          transform: translateY(-2px);
          border-color: rgba(102,88,220,.28);
          box-shadow:
            6px 8px 0 rgba(196,204,255,.9),
            0 20px 34px rgba(34,38,110,.09);
        }

        .companies-control-page .company-record-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          min-width: 0;
          padding: 17px 18px;
          border-bottom: 1px solid rgba(171,181,211,.34);
          background: linear-gradient(135deg, rgba(237,246,255,.92), rgba(248,247,255,.92));
        }

        .companies-control-page .company-record-title {
          min-width: 0;
        }

        .companies-control-page .company-record-title strong {
          display: block;
          color: var(--company-ink);
          font-size: 15px;
          overflow-wrap: anywhere;
        }

        .companies-control-page .company-record-title small {
          display: block;
          margin-top: 4px;
          color: var(--company-muted);
          font-size: 11px;
          overflow-wrap: anywhere;
        }

        .companies-control-page .company-record-head-badges {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 9px;
          flex-wrap: wrap;
          min-width: 0;
        }

        .companies-control-page .company-tenant-chip {
          display: inline-flex;
          align-items: center;
          min-height: 30px;
          max-width: 220px;
          padding: 6px 10px;
          overflow: hidden;
          border-radius: 999px;
          color: #40348d;
          background: #f1efff;
          box-shadow: 2px 3px 0 #c9c0ff;
          font-size: 10px;
          font-weight: 900;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .companies-control-page .company-record-grid {
          display: grid;
          grid-template-columns:
            minmax(0, 1.15fr)
            minmax(0, .95fr)
            minmax(0, 1fr);
          gap: 12px;
          padding: 15px 18px 17px;
        }

        .companies-control-page .company-record-block {
          display: grid;
          align-content: start;
          gap: 11px;
          min-width: 0;
          padding: 14px;
          border: 1px solid rgba(171,181,211,.42);
          border-radius: 17px;
          background: #f9fbff;
        }

        .companies-control-page .company-record-block:nth-child(2) {
          background: #f8f7ff;
        }

        .companies-control-page .company-record-block:nth-child(3) {
          background: #f4fbf8;
        }

        .companies-control-page .company-record-kicker {
          color: #5d6785;
          font-size: 8px;
          font-weight: 950;
          letter-spacing: .085em;
          text-transform: uppercase;
        }

        .companies-control-page .company-record-pairs {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }

        .companies-control-page .company-record-pairs > div {
          min-width: 0;
        }

        .companies-control-page .company-record-pairs span {
          display: block;
          color: #6b7692;
          font-size: 8px;
          font-weight: 900;
          letter-spacing: .05em;
          text-transform: uppercase;
        }

        .companies-control-page .company-record-pairs strong {
          display: block;
          margin-top: 4px;
          color: var(--company-ink);
          font-size: 11px;
          line-height: 1.42;
          overflow-wrap: anywhere;
        }

        .companies-control-page .company-record-action-area {
          display: grid;
          gap: 10px;
          padding: 14px 18px 17px;
          border-top: 1px solid rgba(171,181,211,.34);
          background: rgba(250,251,255,.84);
        }

        .companies-control-page .company-record-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          flex-wrap: wrap;
          gap: 8px;
        }

        .companies-control-page .company-record-actions button,
        .company-modal-actions button {
          min-height: 36px;
          padding: 0 11px;
          font-size: 10px;
        }

        .companies-control-page .company-status-action,
        .company-modal-actions .company-status-action {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          min-height: 36px;
          padding: 0 12px;
          border-radius: 12px;
          font: inherit;
          font-size: 10px;
          font-weight: 900;
          white-space: nowrap;
          cursor: pointer;
          transition:
            transform 180ms var(--company-ease),
            box-shadow 180ms ease,
            background 180ms ease,
            border-color 180ms ease,
            color 180ms ease;
        }

        .companies-control-page .company-status-action.activate,
        .company-modal-actions .company-status-action.activate {
          border: 1px solid rgba(4,120,87,.20);
          color: #047857;
          background: #eaf8f4;
          box-shadow: 3px 4px 0 #aee6d9;
        }

        .companies-control-page .company-status-action.activate.is-current,
        .company-modal-actions .company-status-action.activate.is-current {
          color: #fff;
          background: linear-gradient(135deg, #087f5b, #1fa97a);
          border-color: rgba(4,120,87,.26);
          box-shadow: 3px 4px 0 #8fdac7;
        }

        .companies-control-page .company-status-action.deactivate,
        .company-modal-actions .company-status-action.deactivate {
          border: 1px solid rgba(162,52,77,.20);
          color: #a2344d;
          background: #fff0f2;
          box-shadow: 3px 4px 0 #f2c2cc;
        }

        .companies-control-page .company-status-action.deactivate.is-current,
        .company-modal-actions .company-status-action.deactivate.is-current {
          color: #fff;
          background: linear-gradient(135deg, #a2344d, #d4576f);
          border-color: rgba(162,52,77,.28);
          box-shadow: 3px 4px 0 #efb4c1;
        }

        .companies-control-page .company-status-action:disabled,
        .company-modal-actions .company-status-action:disabled {
          cursor: not-allowed;
        }

        .companies-control-page .company-status-action.is-current:disabled,
        .company-modal-actions .company-status-action.is-current:disabled {
          opacity: 1;
          filter: none;
        }

        .companies-control-page .company-action-feedback,
        .company-modal-action-area .company-action-feedback {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          width: 100%;
          padding: 10px 12px;
          border: 1px solid rgba(4,120,87,.18);
          border-radius: 12px;
          color: #047857;
          background: #eaf8f4;
          box-shadow: 3px 4px 0 #aee6d9;
          font-size: 11px;
          font-weight: 850;
          line-height: 1.45;
        }

        .companies-control-page .company-action-feedback svg,
        .company-modal-action-area .company-action-feedback svg {
          flex: 0 0 auto;
          margin-top: 1px;
        }

        .companies-control-page .company-action-feedback.error,
        .company-modal-action-area .company-action-feedback.error {
          border-color: rgba(162,52,77,.18);
          color: #a2344d;
          background: #fff0f2;
          box-shadow: 3px 4px 0 #f2c2cc;
        }

        .company-feedback-close {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 25px;
          height: 25px;
          min-width: 25px;
          margin: -4px -5px -4px auto;
          padding: 0;
          border: 0;
          border-radius: 8px;
          color: currentColor;
          background: rgba(255,255,255,.56);
          box-shadow: none;
          opacity: .72;
        }

        .company-feedback-close:hover {
          opacity: 1;
          background: rgba(255,255,255,.92);
          transform: none !important;
          filter: none !important;
        }

        .company-modal-action-area {
          display: grid;
          gap: 10px;
          margin-bottom: 22px;
        }

        .company-modal-actions {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }

        .company-modal-actions .ghost {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }

        .companies-control-page .company-empty {
          padding: 38px 20px;
          border: 1px dashed rgba(102,88,220,.28);
          border-radius: 18px;
          color: var(--company-muted);
          background: linear-gradient(145deg, #f8f7ff, #effbf8);
          font-size: 13px;
          font-weight: 800;
          text-align: center;
        }

        .companies-control-page .company-table-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 17px 20px 21px;
          border: 1px solid rgba(171,181,211,.52);
          border-top: 0;
          border-radius: 0 0 20px 20px;
          background: rgba(248,250,255,.86);
        }

        .companies-control-page .company-table-range {
          display: flex;
          align-items: baseline;
          gap: 5px;
          min-width: 0;
          color: var(--company-muted);
          font-size: 10px;
          font-weight: 800;
          white-space: nowrap;
        }

        .companies-control-page .company-table-range strong {
          color: var(--company-ink);
          font-size: 12px;
        }

        .companies-control-page .company-table-pagination {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          min-width: 0;
        }

        .companies-control-page .company-page-numbers {
          display: flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
        }

        .companies-control-page .company-page-arrow,
        .companies-control-page .company-page-number {
          display: inline-flex;
          align-items: center;
          justify-content: center;
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

        .companies-control-page .company-page-number.active {
          border-color: rgba(76,118,220,.22);
          color: #fff;
          background: linear-gradient(135deg, #4c76dc 0%, #2db6b7 100%);
          box-shadow: 4px 5px 0 #595192;
        }

        .companies-control-page .company-page-ellipsis {
          display: inline-grid;
          min-width: 18px;
          place-items: center;
          color: var(--company-muted);
          font-weight: 900;
        }

        .companies-control-page .spin {
          animation: companySpin .8s linear infinite;
        }

        @keyframes companySpin {
          to { transform: rotate(360deg); }
        }

        .company-action-backdrop {
          position: fixed;
          inset: 0;
          z-index: 11000;
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
          background: rgba(15,23,42,.58);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          overscroll-behavior: none;
        }

        .company-action-dialog {
          width: min(620px, calc(100vw - 36px));
          max-height: min(88dvh, 720px);
          overflow: hidden;
          border: 1px solid rgba(171,181,211,.72);
          border-radius: 26px;
          background: linear-gradient(145deg,#ffffff 0%,#f7fbff 55%,#f8f4ff 100%);
          box-shadow:
            0 32px 86px rgba(22,29,73,.32),
            9px 11px 0 rgba(185,215,255,.46);
        }

        .company-action-dialog-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 18px;
          padding: 22px 23px 18px;
          border-bottom: 1px solid rgba(171,181,211,.42);
          background: linear-gradient(135deg, rgba(237,246,255,.97), rgba(248,247,255,.98));
        }

        .company-action-dialog-header > div {
          min-width: 0;
        }

        .company-action-dialog-kicker {
          display: inline-flex;
          align-items: center;
          width: fit-content;
          padding: 7px 10px;
          border-radius: 999px;
          color: #fff;
          background: #342b78;
          box-shadow: 3px 4px 0 #18b5c8;
          font-size: 8px;
          font-weight: 950;
          letter-spacing: .1em;
          text-transform: uppercase;
        }

        .company-action-dialog-header h2 {
          margin: 13px 0 0;
          color: var(--company-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(25px, 3vw, 34px);
          font-weight: 760;
          line-height: 1;
          letter-spacing: -.035em;
        }

        .company-action-dialog-header p {
          margin: 9px 0 0;
          color: var(--company-muted);
          font-size: 11px;
          line-height: 1.55;
        }

        .company-action-dialog-close {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          min-width: 40px;
          height: 40px;
          padding: 0;
          border: 1px solid rgba(65,55,161,.18);
          border-radius: 13px;
          color: #40348d;
          background: #fff;
          box-shadow: 3px 4px 0 rgba(52,43,120,.10);
        }

        .company-action-dialog-body {
          display: grid;
          gap: 14px;
          max-height: calc(88dvh - 190px);
          overflow-y: auto;
          padding: 20px 23px;
          overscroll-behavior: contain;
          -webkit-overflow-scrolling: touch;
        }

        .company-action-field,
        .company-action-field-grid {
          min-width: 0;
        }

        .company-action-field {
          display: grid;
          gap: 8px;
        }

        .company-action-field > span {
          color: #303b5b;
          font-size: 10px;
          font-weight: 900;
        }

        .company-action-field-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }

        .company-action-field input,
        .company-action-field textarea {
          width: 100%;
          min-width: 0;
          border: 1px solid rgba(151,161,197,.58);
          border-radius: 14px;
          outline: 0;
          color: var(--company-ink);
          background: rgba(255,255,255,.98);
          font: inherit;
          font-weight: 650;
          transition:
            border-color 170ms ease,
            box-shadow 170ms ease,
            transform 170ms ease;
        }

        .company-action-field input {
          min-height: 46px;
          padding: 0 13px;
        }

        .company-action-field textarea {
          min-height: 108px;
          padding: 12px 13px;
          resize: vertical;
          line-height: 1.5;
        }

        .company-action-field input:focus,
        .company-action-field textarea:focus {
          border-color: rgba(102,88,220,.65);
          box-shadow:
            4px 5px 0 rgba(102,88,220,.14),
            0 0 0 4px rgba(102,88,220,.08);
          transform: translateY(-1px);
        }

        .company-action-dialog-error {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 11px 12px;
          border: 1px solid rgba(162,52,77,.18);
          border-radius: 12px;
          color: #a2344d;
          background: #fff0f2;
          box-shadow: 3px 4px 0 #f2c2cc;
          font-size: 11px;
          font-weight: 850;
          line-height: 1.45;
        }

        .company-action-dialog-error svg {
          flex: 0 0 auto;
          margin-top: 1px;
        }

        .company-action-dialog-footer {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 10px;
          padding: 16px 23px 20px;
          border-top: 1px solid rgba(171,181,211,.42);
          background: rgba(248,250,255,.90);
        }

        .company-action-dialog-footer .ghost,
        .company-action-dialog-confirm {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-height: 42px;
          padding: 0 14px;
          border-radius: 13px;
          font: inherit;
          font-size: 11px;
          font-weight: 900;
        }

        .company-action-dialog-confirm.primary {
          border: 1px solid rgba(52,43,120,.16);
          color: #fff;
          background: linear-gradient(135deg, #342b78, #4f65d7 58%, #18b5c8);
          box-shadow: 4px 5px 0 #a9d6f5;
        }

        .company-action-dialog-confirm.danger {
          border: 1px solid rgba(162,52,77,.22);
          color: #fff;
          background: linear-gradient(135deg, #a2344d, #d4576f);
          box-shadow: 4px 5px 0 #efb4c1;
        }

        .company-detail-backdrop {
          position: fixed !important;
          inset: 0 !important;
          z-index: 10000 !important;
          display: grid !important;
          place-items: center !important;
          width: 100vw;
          height: 100dvh;
          overflow: hidden;
          padding:
            max(18px, env(safe-area-inset-top))
            max(18px, env(safe-area-inset-right))
            max(18px, env(safe-area-inset-bottom))
            max(18px, env(safe-area-inset-left)) !important;
          background: rgba(15,23,42,.54) !important;
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          overscroll-behavior: none;
        }

        .company-detail-modal {
          position: relative;
          display: grid;
          grid-template-rows: auto minmax(0, 1fr);
          width: min(1040px, calc(100vw - 36px)) !important;
          max-height: min(90dvh, 900px) !important;
          overflow: hidden !important;
          border: 1px solid rgba(171,181,211,.72);
          border-radius: 30px !important;
          background: linear-gradient(145deg,#ffffff 0%,#f7fbff 54%,#f8f4ff 100%) !important;
          box-shadow:
            0 34px 90px rgba(22,29,73,.30),
            10px 12px 0 rgba(185,215,255,.48) !important;
        }

        .company-detail-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 20px;
          min-width: 0;
          padding: 24px 26px 20px;
          border-bottom: 1px solid rgba(171,181,211,.44);
          background:
            linear-gradient(135deg, rgba(237,246,255,.96), rgba(248,247,255,.97));
        }

        .company-detail-heading {
          min-width: 0;
          flex: 1 1 auto;
        }

        .company-detail-kicker {
          display: inline-flex;
          align-items: center;
          width: fit-content;
          padding: 7px 10px;
          border-radius: 999px;
          color: #fff;
          background: #342b78;
          box-shadow: 3px 4px 0 #18b5c8;
          font-size: 8px;
          font-weight: 950;
          letter-spacing: .11em;
          text-transform: uppercase;
        }

        .company-detail-title-row {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 16px;
          min-width: 0;
          margin-top: 12px;
        }

        .company-detail-title-row > div {
          min-width: 0;
        }

        .company-detail-title-row h2 {
          margin: 0;
          color: var(--company-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(28px, 3vw, 42px);
          font-weight: 760;
          line-height: 1;
          letter-spacing: -.04em;
          overflow-wrap: anywhere;
        }

        .company-detail-title-row p {
          margin: 8px 0 0;
          color: var(--company-muted);
          font-size: 12px;
          line-height: 1.5;
          overflow-wrap: anywhere;
        }

        .company-detail-close {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          min-height: 40px;
          padding: 0 12px;
          flex: 0 0 auto;
          border: 1px solid rgba(65,55,161,.18);
          border-radius: 13px;
          color: #40348d;
          background: #fff;
          box-shadow: 3px 4px 0 rgba(52,43,120,.10);
        }

        .company-detail-body {
          min-width: 0;
          overflow-y: auto;
          overflow-x: hidden;
          padding: 22px 24px 26px;
          overscroll-behavior: contain;
          -webkit-overflow-scrolling: touch;
        }

        .company-detail-loading {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          min-height: 260px;
          color: var(--company-muted);
          font-size: 13px;
          font-weight: 800;
        }

        .company-detail-kpis {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 13px;
          margin-bottom: 18px;
        }

        .company-detail-modal .stat-card {
          min-width: 0;
          min-height: 108px !important;
          padding: 16px !important;
          border: 1px solid rgba(171,181,211,.64) !important;
          border-radius: 18px !important;
          background: #edf6ff !important;
          box-shadow: 5px 6px 0 #b9d7ff !important;
        }

        .company-detail-modal .stat-card:nth-child(2) {
          background: #eaf8f4 !important;
          box-shadow: 5px 6px 0 #aee6d9 !important;
        }

        .company-detail-modal .stat-card:nth-child(3) {
          background: #f1efff !important;
          box-shadow: 5px 6px 0 #c9c0ff !important;
        }

        .company-detail-modal .stat-card:nth-child(4) {
          background: #fff4d5 !important;
          box-shadow: 5px 6px 0 #ffe0a5 !important;
        }

        .company-modal-action-area {
          display: grid;
          gap: 12px;
          margin-bottom: 18px;
          padding: 16px;
          border: 1px solid rgba(171,181,211,.50);
          border-radius: 18px;
          background: rgba(255,255,255,.82);
          box-shadow: 4px 5px 0 rgba(196,204,255,.55);
        }

        .company-modal-action-heading {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          min-width: 0;
        }

        .company-modal-action-heading > div {
          min-width: 0;
        }

        .company-modal-action-heading span {
          display: block;
          color: #6b7692;
          font-size: 8px;
          font-weight: 950;
          letter-spacing: .08em;
          text-transform: uppercase;
        }

        .company-modal-action-heading strong {
          display: block;
          margin-top: 3px;
          color: var(--company-ink);
          font-size: 13px;
        }

        .company-modal-actions {
          display: flex;
          align-items: center;
          gap: 9px;
          flex-wrap: wrap;
        }

        .company-modal-actions button {
          min-height: 38px;
          padding: 0 12px;
        }

        .company-protection-note {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          margin-bottom: 18px;
          padding: 13px 14px;
          border: 1px solid rgba(4,120,87,.18);
          border-radius: 15px;
          color: #047857;
          background: #eaf8f4;
          box-shadow: 3px 4px 0 #aee6d9;
        }

        .company-protection-note svg {
          flex: 0 0 auto;
          margin-top: 1px;
        }

        .company-protection-note p {
          margin: 0;
          font-size: 11px;
          line-height: 1.55;
        }

        .company-detail-grid,
        .company-detail-history-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }

        .company-detail-history-grid {
          margin-top: 14px;
        }

        .company-detail-card,
        .company-detail-history-card {
          min-width: 0;
          padding: 17px;
          border: 1px solid rgba(171,181,211,.50);
          border-radius: 18px;
          background: #f9fbff;
          box-shadow: 3px 4px 0 rgba(196,204,255,.48);
        }

        .company-detail-card:nth-child(2) {
          background: #f8f7ff;
        }

        .company-detail-history-card:first-child {
          background: #f4fbf8;
        }

        .company-detail-history-card:last-child {
          background: #fffaf0;
        }

        .company-detail-card-heading {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
          margin-bottom: 14px;
        }

        .company-detail-card-heading > svg {
          flex: 0 0 auto;
          color: #40348d;
        }

        .company-detail-card-heading > div {
          min-width: 0;
        }

        .company-detail-card-heading span {
          display: block;
          color: #6b7692;
          font-size: 8px;
          font-weight: 950;
          letter-spacing: .08em;
          text-transform: uppercase;
        }

        .company-detail-card-heading h3 {
          margin: 3px 0 0;
          color: var(--company-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: 18px;
          line-height: 1.1;
        }

        .company-detail-list {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin: 0;
        }

        .company-detail-list > div {
          min-width: 0;
          padding: 10px 11px;
          border: 1px solid rgba(171,181,211,.34);
          border-radius: 12px;
          background: rgba(255,255,255,.78);
        }

        .company-detail-list dt {
          color: #6b7692;
          font-size: 8px;
          font-weight: 950;
          letter-spacing: .06em;
          text-transform: uppercase;
        }

        .company-detail-list dd {
          margin: 5px 0 0;
          color: var(--company-ink);
          font-size: 11px;
          font-weight: 800;
          line-height: 1.45;
          overflow-wrap: anywhere;
        }

        .company-history-list {
          display: grid;
          gap: 8px;
        }

        .company-history-item {
          display: grid;
          gap: 4px;
          min-width: 0;
          padding: 10px 11px;
          border: 1px solid rgba(171,181,211,.34);
          border-radius: 12px;
          background: rgba(255,255,255,.78);
        }

        .company-history-item strong {
          color: var(--company-ink);
          font-size: 11px;
          overflow-wrap: anywhere;
        }

        .company-history-item span {
          color: var(--company-muted);
          font-size: 10px;
          line-height: 1.4;
          overflow-wrap: anywhere;
        }

        .company-detail-empty {
          margin: 0;
          padding: 14px;
          border: 1px dashed rgba(102,88,220,.24);
          border-radius: 13px;
          color: var(--company-muted);
          background: rgba(255,255,255,.70);
          font-size: 11px;
          line-height: 1.5;
        }

        @media (max-width: 1280px) {
          .companies-control-page .dynamic-form {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .companies-control-page .company-record-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .companies-control-page .company-record-block:last-child {
            grid-column: 1 / -1;
          }
        }

        @media (max-width: 1050px) {
          .companies-control-page > .hero {
            align-items: flex-start;
            flex-direction: column;
            min-height: 0;
          }

          .companies-control-page .dynamic-form {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 820px) {
          .companies-control-page {
            gap: 18px;
          }

          .companies-control-page > .panel {
            padding: 20px;
          }

          .companies-control-page .company-table-tools {
            grid-template-columns: 1fr auto;
          }

          .companies-control-page .company-table-search {
            grid-column: 1 / -1;
          }

          .companies-control-page .company-page-size {
            justify-self: end;
          }

          .companies-control-page .company-data-board {
            display: flex;
            align-items: stretch;
            gap: 14px;
            overflow-x: auto;
            overflow-y: visible;
            padding: 18px 20px 24px;
            scroll-snap-type: x mandatory;
            scroll-padding-inline: 20px;
            overscroll-behavior-x: contain;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: thin;
            scrollbar-color: rgba(102,88,220,.26) transparent;
          }

          .companies-control-page .company-record-card {
            flex: 0 0 100%;
            width: 100%;
            max-width: 100%;
            min-width: 0;
            height: auto;
            max-height: none;
            align-self: stretch;
            scroll-snap-align: start;
            scroll-snap-stop: always;
          }

          .companies-control-page .company-record-grid {
            grid-template-columns: 1fr;
          }

          .companies-control-page .company-record-block:last-child {
            grid-column: auto;
          }

          .companies-control-page .company-table-footer {
            align-items: stretch;
            flex-direction: column;
          }

          .companies-control-page .company-table-pagination {
            justify-content: flex-start;
          }

          .companies-control-page .company-page-numbers {
            max-width: 100%;
            overflow-x: auto;
            padding: 2px 0 4px;
            scrollbar-width: none;
          }

          .companies-control-page .company-page-numbers::-webkit-scrollbar {
            display: none;
          }
        }

        @media (max-width: 680px) {
          .companies-control-page {
            gap: 15px;
          }

          .companies-control-page > .hero {
            padding: 22px 18px;
            border-radius: 26px;
            box-shadow:
              7px 9px 0 #c6d8f7,
              0 20px 34px rgba(34,38,110,.11);
          }

          .companies-control-page > .hero h1 {
            font-size: clamp(34px, 12vw, 50px);
          }

          .companies-control-page > .hero p {
            font-size: 12px;
          }

          .companies-control-page > .panel {
            padding: 17px;
            border-radius: 22px;
            box-shadow:
              5px 7px 0 #c4ccff,
              0 18px 30px rgba(34,38,110,.09);
          }

          .companies-control-page .toolbar {
            align-items: stretch;
            flex-direction: column;
          }

          .companies-control-page .toolbar > * {
            width: 100% !important;
            flex-basis: auto !important;
            max-width: none !important;
          }

          .companies-control-page .toolbar > select {
            min-width: 0;
          }

          .companies-control-page .company-search-action {
            width: 100%;
          }

          .companies-control-page .company-search-feedback {
            position: static;
            width: 100%;
            max-width: none;
            margin-top: 9px;
          }

          .companies-control-page .dynamic-form {
            grid-template-columns: 1fr;
            padding: 17px;
          }

          .companies-control-page .dynamic-form > button {
            width: 100%;
          }

          .companies-control-page .company-table-tools {
            grid-template-columns: 1fr;
            padding: 15px 17px;
          }

          .companies-control-page .company-table-search {
            grid-column: auto;
          }

          .companies-control-page .company-page-size {
            grid-template-columns: 1fr 88px;
            justify-self: stretch;
          }

          .companies-control-page .company-data-board {
            padding: 15px 17px 22px;
            scroll-padding-inline: 17px;
          }

          .companies-control-page .company-record-card {
            flex: 0 0 100%;
            width: 100%;
            max-width: 100%;
            min-width: 0;
            height: auto;
          }

          .companies-control-page .company-record-head {
            align-items: stretch;
            flex-direction: column;
          }

          .companies-control-page .company-record-head-badges {
            justify-content: flex-start;
          }

          .companies-control-page .company-record-pairs {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .companies-control-page .company-record-actions {
            justify-content: stretch;
          }

          .companies-control-page .company-record-actions button {
            flex: 1 1 calc(50% - 8px);
          }

          .companies-control-page .company-table-footer {
            padding: 15px 17px 19px;
          }

          .companies-control-page .company-table-pagination {
            width: 100%;
            justify-content: space-between;
          }

          .companies-control-page .company-page-numbers {
            flex: 1 1 auto;
            justify-content: center;
          }

          .company-detail-backdrop {
            place-items: center !important;
            padding:
              max(10px, env(safe-area-inset-top))
              max(10px, env(safe-area-inset-right))
              max(10px, env(safe-area-inset-bottom))
              max(10px, env(safe-area-inset-left)) !important;
          }

          .company-detail-modal {
            width: calc(100vw - 20px) !important;
            max-height: calc(100dvh - 20px) !important;
            border-radius: 22px !important;
            box-shadow: 0 24px 60px rgba(34,38,110,.24) !important;
          }

          .company-action-backdrop {
            padding:
              max(10px, env(safe-area-inset-top))
              max(10px, env(safe-area-inset-right))
              max(10px, env(safe-area-inset-bottom))
              max(10px, env(safe-area-inset-left));
          }

          .company-action-dialog {
            width: calc(100vw - 20px);
            max-height: calc(100dvh - 20px);
            border-radius: 22px;
          }

          .company-action-field-grid {
            grid-template-columns: 1fr;
          }

          .company-detail-header {
            padding: 18px;
          }

          .company-detail-title-row {
            align-items: flex-start;
            flex-direction: column;
          }

          .company-detail-body {
            padding: 17px;
          }

          .company-detail-kpis {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .company-modal-actions {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .company-modal-actions button {
            width: 100%;
            min-width: 0;
          }

          .company-detail-grid,
          .company-detail-history-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 520px) {
          .companies-control-page > .hero {
            padding: 20px 15px;
          }

          .companies-control-page > .hero h1 {
            font-size: clamp(31px, 11vw, 43px);
          }

          .companies-control-page .kicker {
            white-space: normal;
          }

          .companies-control-page .company-record-card {
            flex: 0 0 100%;
            width: 100%;
            max-width: 100%;
            min-width: 0;
          }

          .companies-control-page .company-record-actions {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .companies-control-page .company-record-actions button {
            width: 100%;
            min-width: 0;
            padding-left: 8px;
            padding-right: 8px;
          }

          .companies-control-page .company-page-arrow,
          .companies-control-page .company-page-number {
            width: 38px;
            min-width: 38px;
            height: 38px;
          }

          .company-action-dialog-header {
            gap: 12px;
            padding: 16px;
          }

          .company-action-dialog-body {
            padding: 16px;
          }

          .company-action-dialog-footer {
            display: grid;
            grid-template-columns: 1fr 1fr;
            padding: 14px 16px 17px;
          }

          .company-action-dialog-footer button {
            width: 100%;
          }

          .company-detail-header {
            gap: 12px;
            padding: 15px;
          }

          .company-detail-close {
            width: 38px;
            min-width: 38px;
            height: 38px;
            padding: 0;
          }

          .company-detail-close span {
            display: none;
          }

          .company-detail-body {
            padding: 14px;
          }

          .company-detail-kpis {
            gap: 10px;
          }

          .company-detail-modal .stat-card {
            min-height: 96px !important;
            padding: 13px !important;
          }

          .company-modal-action-area,
          .company-detail-card,
          .company-detail-history-card {
            padding: 13px;
          }

          .company-detail-list {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 380px) {
          .companies-control-page {
            gap: 13px;
          }

          .companies-control-page > .hero {
            padding: 18px 13px;
          }

          .companies-control-page > .panel {
            padding: 13px;
          }

          .companies-control-page .company-table-tools,
          .companies-control-page .company-table-footer {
            padding-left: 13px;
            padding-right: 13px;
          }

          .companies-control-page .company-data-board {
            padding-left: 13px;
            padding-right: 13px;
            scroll-padding-inline: 13px;
          }

          .companies-control-page .company-record-card {
            flex: 0 0 100%;
            width: 100%;
            max-width: 100%;
            min-width: 0;
          }

          .companies-control-page .company-page-arrow,
          .companies-control-page .company-page-number {
            width: 35px;
            min-width: 35px;
            height: 35px;
          }

          .company-detail-kpis,
          .company-modal-actions {
            grid-template-columns: 1fr;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .companies-control-page *,
          .companies-control-page *::before,
          .companies-control-page *::after,
          .company-detail-backdrop,
          .company-detail-modal {
            scroll-behavior: auto !important;
            animation-duration: .01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: .01ms !important;
          }
        }
      `}</style>

      <section className="hero compact">
        <div>
          <span className="kicker">SaaS Tenant Control</span>
          <h1>Companies / Tenants</h1>
          <p>
            Monitor all companies using YourComate HRMS, manage trial and paid
            tenants, extend trial access, suspend accounts, and protect SDS
            lifetime access.
          </p>
        </div>
      </section>

      <section className="panel">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
            gap: 14,
            marginBottom: 22,
          }}
        >
          <SummaryCard icon={Building2} label="Total Companies" value={summary.total || rows.length || 0} />
          <SummaryCard icon={ShieldCheck} label="Lifetime" value={summary.lifetime || 0} tone="#16a34a" />
          <SummaryCard icon={CalendarClock} label="Trial" value={summary.demo || 0} tone="#2563eb" />
          <SummaryCard icon={IndianRupee} label="Paid" value={summary.paid || 0} tone="#7c3aed" />
          <SummaryCard icon={AlertTriangle} label="Expired" value={summary.expired || 0} tone="#dc2626" />
        </div>

        <div
          className="toolbar"
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <div className="search" style={{ flex: '1 1 280px' }}>
            <Search size={16} />
            <input
              value={filters.q}
              onChange={(e) => {
                setFilters({ ...filters, q: e.target.value });
                setSearchFeedback(null);
              }}
              placeholder="Search company, email, tenant code..."
            />
          </div>

          <select
            value={filters.status}
            onChange={(e) => {
              setFilters({ ...filters, status: e.target.value });
              setSearchFeedback(null);
            }}
            style={{
              minHeight: 42,
              borderRadius: 14,
              border: '1px solid rgba(226,232,240,0.9)',
              padding: '0 12px',
              background: '#ffffff',
            }}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            value={filters.plan_type}
            onChange={(e) => {
              setFilters({ ...filters, plan_type: e.target.value });
              setSearchFeedback(null);
            }}
            style={{
              minHeight: 42,
              borderRadius: 14,
              border: '1px solid rgba(226,232,240,0.9)',
              padding: '0 12px',
              background: '#ffffff',
            }}
          >
            {PLAN_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <div className="company-search-action">
            <button
              type="button"
              className="primary company-target-search-button"
              onClick={() => load({ showSearchFeedback: true })}
              disabled={loading}
            >
              <RefreshCw size={16} className={loading ? 'spin' : ''} />
              Search
            </button>

            {searchFeedback ? (
              <div
                className={`company-search-feedback ${searchFeedback.type || 'info'}`}
                role="status"
              >
                {searchFeedback.type === 'error' ? (
                  <AlertTriangle size={15} />
                ) : searchFeedback.type === 'success' ? (
                  <CheckCircle2 size={15} />
                ) : (
                  <Search size={15} />
                )}
                <span>{searchFeedback.text}</span>
                <button
                  type="button"
                  className="company-feedback-close"
                  onClick={() => setSearchFeedback(null)}
                  aria-label="Dismiss search message"
                >
                  <X size={13} />
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <form
          className="dynamic-form"
          onSubmit={submit}
          style={{
            marginTop: 20,
          }}
        >
          <label>
            Company Name
            <input
              value={form.company_name ?? ''}
              onChange={(e) => {
                handleChange('company_name', e.target.value);
                handleChange('name', e.target.value);
              }}
              placeholder="Example: ABC Private Limited"
              required
            />
          </label>

          <label>
            Tenant ID
            <input
              value={form.tenant_id ?? ''}
              onChange={(e) => handleChange('tenant_id', e.target.value)}
              placeholder="Example: abc-pvt-ltd"
            />
          </label>

          <label>
            Tenant Code
            <input
              value={form.tenant_code ?? ''}
              onChange={(e) => handleChange('tenant_code', e.target.value)}
              placeholder="Example: ABC"
            />
          </label>

          <label>
            Company Email
            <input
              type="email"
              value={form.company_email ?? ''}
              onChange={(e) => {
                handleChange('company_email', e.target.value);
                handleChange('contact_email', e.target.value);
              }}
              placeholder="company@example.com"
            />
          </label>

          <label>
            Company Phone
            <input
              value={form.company_phone ?? ''}
              onChange={(e) => {
                handleChange('company_phone', e.target.value);
                handleChange('contact_phone', e.target.value);
              }}
              placeholder="Phone number"
            />
          </label>

          <label>
            Plan Type
            <select
              value={form.plan_type ?? 'paid'}
              onChange={(e) => handleChange('plan_type', e.target.value)}
            >
              <option value="paid">Paid</option>
              <option value="demo">Trial</option>
              <option value="lifetime">Lifetime</option>
            </select>
          </label>

          <label>
            Status
            <select
              value={form.status ?? 'active'}
              onChange={(e) => handleChange('status', e.target.value)}
            >
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="expired">Expired</option>
              <option value="suspended">Suspended</option>
            </select>
          </label>

          <label>
            Employee Limit
            <input
              value={form.employee_limit ?? ''}
              onChange={(e) => handleChange('employee_limit', e.target.value)}
              placeholder="Blank = unlimited"
            />
          </label>

          <label>
            Admin Name
            <input
              value={form.admin_name ?? ''}
              onChange={(e) => handleChange('admin_name', e.target.value)}
              placeholder="Company Admin"
            />
          </label>

          <label>
            Admin Email
            <input
              type="email"
              value={form.admin_email ?? ''}
              onChange={(e) => handleChange('admin_email', e.target.value)}
              placeholder="admin@example.com"
            />
          </label>

          <label>
            Admin Password
            <input
              value={form.admin_password ?? ''}
              onChange={(e) => handleChange('admin_password', e.target.value)}
              placeholder="Admin@123"
            />
          </label>

          <label>
            Domain
            <input
              value={form.domain ?? ''}
              onChange={(e) => handleChange('domain', e.target.value)}
              placeholder="example.com"
            />
          </label>

          <label style={{ gridColumn: '1 / -1' }}>
            Address
            <input
              value={form.address ?? ''}
              onChange={(e) => handleChange('address', e.target.value)}
              placeholder="Company address"
            />
          </label>

          <button className="primary company-target-create-button" disabled={saving}>
            {saving ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}
            Create Company
          </button>
        </form>

        {message && (
          <div
            className="inline-message"
            style={{
              marginTop: 16,
            }}
          >
            {message}
          </div>
        )}

        <div className="company-table-tools">
          <div className="company-table-search">
            <Search size={17} />
            <input
              type="search"
              value={tableSearch}
              onChange={(event) => {
                setTableSearch(event.target.value);
                setTablePage(1);
              }}
              placeholder="Search within company records"
              aria-label="Search within company records"
            />
          </div>

          <div className="company-table-summary">
            <strong>{filteredCompanyRows.length.toLocaleString('en-IN')}</strong>
            <span>{filteredCompanyRows.length === 1 ? 'company' : 'companies'}</span>
          </div>

          <label className="company-page-size">
            <span>Rows per page</span>
            <select
              value={tablePageSize}
              onChange={(event) => {
                setTablePageSize(Number(event.target.value));
                setTablePage(1);
              }}
              aria-label="Rows per page"
            >
              {COMPANY_PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="company-data-board">
          {loading ? (
            <div className="company-empty">
              <Loader2 size={18} className="spin" style={{ marginRight: 8 }} />
              Loading companies...
            </div>
          ) : visibleCompanyRows.length ? (
            visibleCompanyRows.map((row) => {
              const tenantId = getTenantId(row);
              const isSds =
                row.is_sds_company === true ||
                String(row.tenant_code || '').toLowerCase() === 'sds';
              const normalizedStatus = String(row.status || '').toLowerCase();
              const isActive = normalizedStatus === 'active';
              const isDeactivated = normalizedStatus === 'suspended';
              const rowActionBusy = actionBusy[tenantId];
              const rowActionFeedback = actionFeedback[tenantId];

              return (
                <article className="company-record-card" key={tenantId || row._id}>
                  <header className="company-record-head">
                    <div className="company-record-title">
                      <strong>{getCompanyName(row)}</strong>
                      <small>{safeText(getCompanyEmail(row))}</small>
                    </div>

                    <div className="company-record-head-badges">
                      <span className="company-tenant-chip">{safeText(row.tenant_code)}</span>
                      <StatusBadge value={row.plan_type || row.plan} />
                      <StatusBadge value={row.status} />
                      {isSds ? <StatusBadge value="Lifetime SDS" /> : null}
                    </div>
                  </header>

                  <div className="company-record-grid">
                    <section className="company-record-block">
                      <span className="company-record-kicker">Company & tenant</span>
                      <div className="company-record-pairs">
                        <div>
                          <span>Company</span>
                          <strong>{getCompanyName(row)}</strong>
                        </div>
                        <div>
                          <span>Email</span>
                          <strong>{safeText(getCompanyEmail(row))}</strong>
                        </div>
                        <div>
                          <span>Tenant Code</span>
                          <strong>{safeText(row.tenant_code)}</strong>
                        </div>
                        <div>
                          <span>Tenant ID</span>
                          <strong>{safeText(tenantId)}</strong>
                        </div>
                      </div>
                    </section>

                    <section className="company-record-block">
                      <span className="company-record-kicker">Subscription</span>
                      <div className="company-record-pairs">
                        <div>
                          <span>Plan</span>
                          <strong>{badgeText(row.plan_type || row.plan)}</strong>
                        </div>
                        <div>
                          <span>Status</span>
                          <strong>{badgeText(row.status)}</strong>
                        </div>
                        <div>
                          <span>Trial / Subscription End</span>
                          <strong>{formatDate(row.trial_end_date || row.subscription_end_date)}</strong>
                        </div>
                      </div>
                    </section>

                    <section className="company-record-block">
                      <span className="company-record-kicker">Capacity</span>
                      <div className="company-record-pairs">
                        <div>
                          <span>Employees</span>
                          <strong>{getEmployeeCount(row)}</strong>
                        </div>
                        <div>
                          <span>Employee Limit</span>
                          <strong>{getEmployeeLimit(row)}</strong>
                        </div>
                        <div>
                          <span>Usage</span>
                          <strong>{getEmployeeCount(row)} / {getEmployeeLimit(row)}</strong>
                        </div>
                      </div>
                    </section>
                  </div>

                  <footer className="company-record-action-area">
                    <div className="company-record-actions">
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => openDetail(tenantId)}
                        disabled={Boolean(rowActionBusy)}
                      >
                        <Eye size={15} />
                        View
                      </button>

                      <button
                        type="button"
                        className={`company-status-action activate ${isActive ? 'is-current' : ''}`}
                        onClick={() => runCompanyAction(tenantId, 'activate')}
                        disabled={Boolean(rowActionBusy) || isActive}
                      >
                        {rowActionBusy === 'activate' ? (
                          <Loader2 size={15} className="spin" />
                        ) : isActive ? (
                          <CheckCircle2 size={15} />
                        ) : (
                          <PlayCircle size={15} />
                        )}
                        {isActive ? 'Active' : 'Activate'}
                      </button>

                      <button
                        type="button"
                        className={`company-status-action deactivate ${isDeactivated ? 'is-current' : ''}`}
                        onClick={() => handleSuspend(tenantId)}
                        disabled={Boolean(rowActionBusy) || isSds || isDeactivated}
                      >
                        {rowActionBusy === 'suspend' ? (
                          <Loader2 size={15} className="spin" />
                        ) : (
                          <PauseCircle size={15} />
                        )}
                        {isDeactivated ? 'Deactivated' : 'Deactivate'}
                      </button>

                    </div>

                    {rowActionFeedback ? (
                      <div
                        className={`company-action-feedback ${rowActionFeedback.type || 'success'}`}
                        role="status"
                      >
                        {rowActionFeedback.type === 'error' ? (
                          <AlertTriangle size={16} />
                        ) : (
                          <CheckCircle2 size={16} />
                        )}
                        <span>{rowActionFeedback.text}</span>
                        <button
                          type="button"
                          className="company-feedback-close"
                          onClick={() =>
                            setActionFeedback((prev) => {
                              const next = { ...prev };
                              delete next[tenantId];
                              return next;
                            })
                          }
                          aria-label="Dismiss action message"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : null}
                  </footer>
                </article>
              );
            })
          ) : (
            <div className="company-empty">
              {tableSearch ? 'No companies match the current table search.' : 'No companies found.'}
            </div>
          )}
        </div>

        <div className="company-table-footer">
          <div className="company-table-range">
            <span>Showing</span>
            <strong>
              {filteredCompanyRows.length
                ? `${companyStartIndex + 1}–${Math.min(companyStartIndex + tablePageSize, filteredCompanyRows.length)}`
                : '0–0'}
            </strong>
            <span>of {filteredCompanyRows.length.toLocaleString('en-IN')}</span>
          </div>

          <div className="company-table-pagination" aria-label="Company pagination">
            <button
              type="button"
              className="company-page-arrow"
              onClick={() => setTablePage(Math.max(1, currentCompanyPage - 1))}
              disabled={currentCompanyPage <= 1}
              aria-label="Previous company page"
            >
              ‹
            </button>

            <div className="company-page-numbers">
              {companyPageNumbers.map((item) =>
                typeof item === 'number' ? (
                  <button
                    type="button"
                    key={item}
                    className={`company-page-number ${item === currentCompanyPage ? 'active' : ''}`}
                    onClick={() => setTablePage(item)}
                    aria-current={item === currentCompanyPage ? 'page' : undefined}
                  >
                    {item}
                  </button>
                ) : (
                  <span className="company-page-ellipsis" key={item}>…</span>
                ),
              )}
            </div>

            <button
              type="button"
              className="company-page-arrow"
              onClick={() => setTablePage(Math.min(companyPageCount, currentCompanyPage + 1))}
              disabled={currentCompanyPage >= companyPageCount}
              aria-label="Next company page"
            >
              ›
            </button>
          </div>
        </div>
      </section>

      <DetailModal
        detail={detail}
        loading={detailLoading}
        onClose={() => {
          setDetail(null);
          setSelectedTenantId('');
        }}
        onActivate={(tenantId) => runCompanyAction(tenantId, 'activate')}
        onSuspend={handleSuspend}
        onExtendDemo={handleExtendDemo}
        onMarkPaid={handleMarkPaid}
        onDismissActionFeedback={() => {
          if (!selectedTenantId) {
            return;
          }

          setActionFeedback((prev) => {
            const next = { ...prev };
            delete next[selectedTenantId];
            return next;
          });
        }}
        actionFeedback={selectedTenantId ? actionFeedback[selectedTenantId] : null}
        actionBusy={selectedTenantId ? actionBusy[selectedTenantId] : null}
      />

      <CompanyActionDialog
        dialog={actionDialog}
        form={actionDialogForm}
        setForm={setActionDialogForm}
        error={actionDialogError}
        onClose={closeActionDialog}
        onSubmit={submitActionDialog}
      />
    </div>
  );
}