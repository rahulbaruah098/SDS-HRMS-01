import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  BellRing,
  Building2,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Clock3,
  CreditCard,
  ExternalLink,
  FileText,
  History,
  IndianRupee,
  Loader2,
  Mail,
  MessageSquare,
  PencilLine,
  Phone,
  RefreshCw,
  Save,
  Search,
  Send,
  ShieldCheck,
  Tag,
  Users,
  XCircle,
} from 'lucide-react';

import { api } from '../api/client';
import { useCustomAlert } from '../components/CustomAlertProvider.jsx';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Requests' },
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'requirements_collected', label: 'Requirements Collected' },
  { value: 'quoted', label: 'Quoted' },
  { value: 'payment_pending', label: 'Payment Pending' },
  { value: 'converted', label: 'Converted' },
  { value: 'closed', label: 'Closed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const UPDATE_STATUS_OPTIONS = STATUS_OPTIONS.filter((item) => item.value !== 'all');

const DEFAULT_FILTERS = {
  status: 'new',
  search: '',
};

const DEFAULT_EDIT_FORM = {
  status: 'contacted',
  sales_note: '',
  quoted_amount: '',
  quoted_currency: 'INR',
  quoted_employee_limit: '',
  quoted_billing_interval: 'monthly',
  quotation_reference: '',
  payment_link: '',
  payment_due_date: '',
  quotation_valid_until: '',
  follow_up_date: '',
};

const FIELD_STYLE = {
  minHeight: 44,
  borderRadius: 14,
  border: '1px solid #cbd5e1',
  padding: '0 14px',
  background: '#ffffff',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

function safeText(value, fallback = '—') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatCurrency(value, currency = 'INR') {
  const amount = toNumber(value, 0);

  if (amount <= 0) {
    return '—';
  }

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

function formatDate(value, includeTime = true) {
  if (!value) {
    return '—';
  }

  let normalized = value;

  if (typeof normalized === 'object' && normalized.$date) {
    normalized = normalized.$date;
  }

  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    return safeText(normalized);
  }

  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(includeTime
      ? {
          hour: '2-digit',
          minute: '2-digit',
        }
      : {}),
  });
}

function dateInputValue(value) {
  if (!value) {
    return '';
  }

  let normalized = value;

  if (typeof normalized === 'object' && normalized.$date) {
    normalized = normalized.$date;
  }

  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toISOString().slice(0, 10);
}

function statusLabel(value) {
  return safeText(value)
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
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

function requestId(request) {
  return request?._id || request?.id || '';
}

function isPaidRequest(request) {
  const status = String(request?.status || '').toLowerCase();
  const paymentStatus = String(request?.payment_status || '').toLowerCase();
  const quotationStatus = String(request?.quotation_status || '').toLowerCase();

  return (
    status === 'converted' ||
    paymentStatus === 'paid' ||
    quotationStatus === 'converted'
  );
}

function isPaymentPending(request) {
  const status = String(request?.status || '').toLowerCase();
  const paymentStatus = String(request?.payment_status || '').toLowerCase();
  const quotationStatus = String(request?.quotation_status || '').toLowerCase();

  return (
    status === 'payment_pending' ||
    ['pending', 'order_created'].includes(paymentStatus) ||
    quotationStatus === 'sent'
  );
}

function getStatusStyle(status) {
  const normalized = String(status || '').trim().toLowerCase();

  if (normalized === 'converted') {
    return {
      background: 'rgba(22, 163, 74, 0.12)',
      color: '#166534',
      border: '1px solid rgba(22, 163, 74, 0.25)',
    };
  }

  if (['closed', 'cancelled'].includes(normalized)) {
    return {
      background: 'rgba(220, 38, 38, 0.12)',
      color: '#991b1b',
      border: '1px solid rgba(220, 38, 38, 0.25)',
    };
  }

  if (['quoted', 'payment_pending'].includes(normalized)) {
    return {
      background: 'rgba(234, 88, 12, 0.12)',
      color: '#9a3412',
      border: '1px solid rgba(234, 88, 12, 0.25)',
    };
  }

  if (['contacted', 'requirements_collected'].includes(normalized)) {
    return {
      background: 'rgba(37, 99, 235, 0.12)',
      color: '#1d4ed8',
      border: '1px solid rgba(37, 99, 235, 0.25)',
    };
  }

  return {
    background: 'rgba(100, 116, 139, 0.12)',
    color: '#334155',
    border: '1px solid rgba(100, 116, 139, 0.25)',
  };
}

function StatusBadge({ status }) {
  const normalized = String(status || '').trim().toLowerCase();

  return (
    <span
      style={{
        ...getStatusStyle(status),
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        borderRadius: 999,
        padding: '6px 10px',
        fontSize: 12,
        fontWeight: 800,
        whiteSpace: 'nowrap',
      }}
    >
      {normalized === 'converted' ? <CheckCircle2 size={14} /> : null}
      {['closed', 'cancelled'].includes(normalized) ? <XCircle size={14} /> : null}
      {!['converted', 'closed', 'cancelled'].includes(normalized) ? (
        <CalendarClock size={14} />
      ) : null}
      {statusLabel(status)}
    </span>
  );
}

function alertTheme(level = 'info') {
  const normalized = String(level || 'info').toLowerCase();

  if (normalized === 'error') {
    return {
      background: '#fef2f2',
      border: '1px solid rgba(220,38,38,0.25)',
      color: '#991b1b',
      icon: XCircle,
    };
  }

  if (normalized === 'warning') {
    return {
      background: '#fffbeb',
      border: '1px solid rgba(245,158,11,0.28)',
      color: '#92400e',
      icon: AlertTriangle,
    };
  }

  if (normalized === 'success') {
    return {
      background: '#f0fdf4',
      border: '1px solid rgba(22,163,74,0.25)',
      color: '#166534',
      icon: CheckCircle2,
    };
  }

  return {
    background: '#eff6ff',
    border: '1px solid rgba(37,99,235,0.24)',
    color: '#1e40af',
    icon: AlertCircle,
  };
}

function deriveRequestAlert(request) {
  if (!request) {
    return {
      level: 'info',
      title: 'Premium request',
      message: 'Select a Premium request to view its current status.',
    };
  }

  if (request.alert_message) {
    return {
      level: request.alert_level || 'info',
      title:
        request.alert_level === 'error'
          ? 'Action required'
          : request.alert_level === 'warning'
            ? 'Attention required'
            : request.alert_level === 'success'
              ? 'Premium subscription active'
              : 'Premium request update',
      message: request.alert_message,
    };
  }

  if (isPaidRequest(request)) {
    return {
      level: 'success',
      title: 'Premium subscription activated',
      message: request.next_due_date
        ? `Payment is complete. The next subscription due date is ${formatDate(request.next_due_date, false)}.`
        : 'Payment is complete and the Premium subscription is active.',
    };
  }

  if (isPaymentPending(request)) {
    const days = request.payment_days_left;
    let dueMessage = 'The quotation is visible to the client and payment is pending.';

    if (Number.isFinite(Number(days))) {
      if (Number(days) < 0) {
        dueMessage = `Payment is overdue by ${Math.abs(Number(days))} day(s). Follow up with the client.`;
      } else if (Number(days) === 0) {
        dueMessage = 'Premium quotation payment is due today.';
      } else {
        dueMessage = `Premium quotation payment is due in ${Number(days)} day(s).`;
      }
    }

    return {
      level: Number(days) < 0 ? 'error' : 'warning',
      title: Number(days) < 0 ? 'Premium payment overdue' : 'Premium payment pending',
      message: dueMessage,
    };
  }

  if (request.client_visible) {
    return {
      level: 'info',
      title: 'Quotation released',
      message: 'The current quotation is visible in the client company Billing page.',
    };
  }

  return {
    level: 'info',
    title: 'Internal Premium request',
    message: 'This request is still internal. Save Draft will not expose it to the client.',
  };
}

function AlertBanner({ alert, compact = false }) {
  const theme = alertTheme(alert?.level);
  const Icon = theme.icon;

  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: compact ? 12 : 16,
        borderRadius: compact ? 16 : 20,
        background: theme.background,
        border: theme.border,
        color: theme.color,
        lineHeight: 1.6,
      }}
    >
      <Icon size={compact ? 18 : 21} style={{ flex: '0 0 auto', marginTop: 2 }} />
      <div>
        <div style={{ fontWeight: 900 }}>{safeText(alert?.title, 'Billing alert')}</div>
        <div style={{ marginTop: 2, fontSize: compact ? 12 : 14 }}>
          {safeText(alert?.message, 'No additional information is available.')}
        </div>
      </div>
    </div>
  );
}

function requirementText(requirements = {}, key, fallback = '—') {
  if (!requirements || typeof requirements !== 'object') {
    return fallback;
  }

  return safeText(requirements[key], fallback);
}

function DetailItem({ icon: Icon, label, value, tone = 'default' }) {
  const toneMap = {
    default: { background: '#ffffff', color: '#0f172a' },
    success: { background: '#f0fdf4', color: '#166534' },
    warning: { background: '#fffbeb', color: '#92400e' },
    info: { background: '#eff6ff', color: '#1e40af' },
  };
  const selectedTone = toneMap[tone] || toneMap.default;

  return (
    <div
      style={{
        padding: 14,
        borderRadius: 18,
        background: selectedTone.background,
        border: '1px solid rgba(226,232,240,0.9)',
        minHeight: 82,
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          color: '#64748b',
          fontSize: 12,
          fontWeight: 800,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        <Icon size={15} />
        {label}
      </div>
      <div
        style={{
          marginTop: 8,
          color: selectedTone.color,
          fontWeight: 800,
          lineHeight: 1.5,
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </div>
    </div>
  );
}

function RequestCard({ request, selected, onSelect }) {
  const employeeCount =
    request.employee_count ||
    request.requirements?.employee_count ||
    request.requirements?.current_employees_used ||
    '—';
  const alert = deriveRequestAlert(request);
  const paid = isPaidRequest(request);

  return (
    <button
      className={`premium-request-card ${selected ? 'selected' : ''}`}
      type="button"
      onClick={() => onSelect(request)}
      style={{
        width: '100%',
        textAlign: 'left',
        borderRadius: 22,
        border: selected
          ? '1px solid rgba(37,99,235,0.45)'
          : '1px solid rgba(226,232,240,0.95)',
        background: selected
          ? 'linear-gradient(135deg, rgba(239,246,255,0.96), rgba(236,253,245,0.92))'
          : '#ffffff',
        boxShadow: selected
          ? '0 18px 45px rgba(37,99,235,0.13)'
          : '0 12px 30px rgba(15,23,42,0.06)',
        padding: 18,
        cursor: 'pointer',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          alignItems: 'flex-start',
        }}
      >
        <div>
          <h3 style={{ margin: 0, color: '#0f172a', fontSize: 17 }}>
            {safeText(request.company_name, 'Premium Request')}
          </h3>
          <p style={{ margin: '6px 0 0', color: '#64748b', fontSize: 13 }}>
            {safeText(request.request_reference || requestId(request), 'No reference')}
          </p>
        </div>

        <StatusBadge status={request.status || 'new'} />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))',
          gap: 10,
          marginTop: 14,
          color: '#475569',
          fontSize: 13,
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <Users size={14} />
          {employeeCount} employees
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <IndianRupee size={14} />
          {formatCurrency(
            request.renewal_amount || request.quoted_amount,
            request.quoted_currency,
          )}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <CalendarClock size={14} />
          {paid ? formatDate(request.paid_at) : formatDate(request.created_at)}
        </span>
      </div>

      <div style={{ marginTop: 14 }}>
        <AlertBanner alert={alert} compact />
      </div>
    </button>
  );
}

function HistoryList({ title, items, type }) {
  const rows = Array.isArray(items) ? [...items].reverse() : [];

  return (
    <section
      className="premium-history-section"
      style={{
        marginTop: 18,
        padding: 18,
        borderRadius: 22,
        background: '#f8fafc',
        border: '1px solid rgba(226,232,240,0.95)',
      }}
    >
      <h3
        style={{
          margin: 0,
          color: '#0f172a',
          display: 'flex',
          alignItems: 'center',
          gap: 9,
        }}
      >
        <History size={19} />
        {title}
      </h3>

      {rows.length ? (
        <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
          {rows.map((item, index) => {
            const isPayment = type === 'payment';
            const date =
              item.paid_at || item.published_at || item.quotation_sent_at || item.created_at;
            const amount = item.amount || item.renewal_amount || item.quoted_amount;
            const interval = item.billing_interval || item.quoted_billing_interval;
            const reference =
              item.razorpay_payment_id ||
              item.quotation_reference ||
              item.request_reference ||
              `Entry ${rows.length - index}`;

            return (
              <div
                key={`${reference}-${index}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(160px, 1.2fr) repeat(3, minmax(110px, 0.8fr))',
                  gap: 10,
                  alignItems: 'center',
                  padding: 12,
                  borderRadius: 16,
                  background: '#ffffff',
                  border: '1px solid rgba(226,232,240,0.9)',
                  fontSize: 13,
                }}
              >
                <div>
                  <div style={{ color: '#0f172a', fontWeight: 900 }}>{safeText(reference)}</div>
                  <div style={{ marginTop: 4, color: '#64748b' }}>{formatDate(date)}</div>
                </div>
                <div>
                  <div style={{ color: '#64748b', fontSize: 11, fontWeight: 800 }}>AMOUNT</div>
                  <div style={{ marginTop: 3, color: '#0f172a', fontWeight: 800 }}>
                    {formatCurrency(amount, item.currency || item.quoted_currency)}
                  </div>
                </div>
                <div>
                  <div style={{ color: '#64748b', fontSize: 11, fontWeight: 800 }}>INTERVAL</div>
                  <div style={{ marginTop: 3, color: '#0f172a', fontWeight: 800 }}>
                    {statusLabel(interval)}
                  </div>
                </div>
                <div>
                  <div style={{ color: '#64748b', fontSize: 11, fontWeight: 800 }}>STATUS</div>
                  <div style={{ marginTop: 3, color: isPayment ? '#166534' : '#1d4ed8', fontWeight: 900 }}>
                    {statusLabel(item.status || (isPayment ? 'paid' : 'sent'))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p style={{ margin: '12px 0 0', color: '#64748b' }}>No history is available yet.</p>
      )}
    </section>
  );
}

function QuotationForm({ form, setForm, onUpdate, updating, isRevision }) {
  return (
    <form className="premium-quotation-form" onSubmit={onUpdate} style={{ marginTop: 22 }}>
      <h3 style={{ margin: '0 0 6px', color: '#0f172a' }}>
        {isRevision ? 'Revise Premium Quotation' : 'Sales / Superadmin Follow-up'}
      </h3>
      <p style={{ margin: '0 0 16px', color: '#64748b', lineHeight: 1.6 }}>
        Save Draft keeps all changes internal. The client sees revised pricing only after you click
        Send Quotation to Client Panel.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 14,
        }}
      >
        <label style={{ display: 'grid', gap: 7 }}>
          <span style={{ color: '#334155', fontWeight: 800, fontSize: 13 }}>Status</span>
          <select
            value={form.status}
            onChange={(event) =>
              setForm((current) => ({ ...current, status: event.target.value }))
            }
            style={FIELD_STYLE}
          >
            {UPDATE_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: 'grid', gap: 7 }}>
          <span style={{ color: '#334155', fontWeight: 800, fontSize: 13 }}>
            Quoted Amount
          </span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.quoted_amount}
            onChange={(event) =>
              setForm((current) => ({ ...current, quoted_amount: event.target.value }))
            }
            placeholder="Example: 9999"
            style={FIELD_STYLE}
          />
        </label>

        <label style={{ display: 'grid', gap: 7 }}>
          <span style={{ color: '#334155', fontWeight: 800, fontSize: 13 }}>Currency</span>
          <input
            type="text"
            value={form.quoted_currency}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                quoted_currency: event.target.value.toUpperCase(),
              }))
            }
            placeholder="INR"
            style={FIELD_STYLE}
          />
        </label>

        <label style={{ display: 'grid', gap: 7 }}>
          <span style={{ color: '#334155', fontWeight: 800, fontSize: 13 }}>
            Employee Limit
          </span>
          <input
            type="number"
            min="0"
            value={form.quoted_employee_limit}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                quoted_employee_limit: event.target.value,
              }))
            }
            placeholder="0 = Unlimited"
            style={FIELD_STYLE}
          />
        </label>

        <label style={{ display: 'grid', gap: 7 }}>
          <span style={{ color: '#334155', fontWeight: 800, fontSize: 13 }}>
            Billing Interval
          </span>
          <select
            value={form.quoted_billing_interval}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                quoted_billing_interval: event.target.value,
              }))
            }
            style={FIELD_STYLE}
          >
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="yearly">Yearly</option>
            <option value="one_time">One-time</option>
            <option value="custom">Custom</option>
          </select>
        </label>

        <label style={{ display: 'grid', gap: 7 }}>
          <span style={{ color: '#334155', fontWeight: 800, fontSize: 13 }}>
            Follow-up Date
          </span>
          <input
            type="date"
            value={form.follow_up_date}
            onChange={(event) =>
              setForm((current) => ({ ...current, follow_up_date: event.target.value }))
            }
            style={FIELD_STYLE}
          />
        </label>

        <label style={{ display: 'grid', gap: 7 }}>
          <span style={{ color: '#334155', fontWeight: 800, fontSize: 13 }}>
            Payment Due Date
          </span>
          <input
            type="date"
            value={form.payment_due_date}
            onChange={(event) =>
              setForm((current) => ({ ...current, payment_due_date: event.target.value }))
            }
            style={FIELD_STYLE}
          />
        </label>

        <label style={{ display: 'grid', gap: 7 }}>
          <span style={{ color: '#334155', fontWeight: 800, fontSize: 13 }}>
            Quotation Valid Until
          </span>
          <input
            type="date"
            value={form.quotation_valid_until}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                quotation_valid_until: event.target.value,
              }))
            }
            style={FIELD_STYLE}
          />
        </label>
      </div>

      <label style={{ display: 'grid', gap: 7, marginTop: 14 }}>
        <span style={{ color: '#334155', fontWeight: 800, fontSize: 13 }}>
          Quotation Reference
        </span>
        <input
          type="text"
          value={form.quotation_reference}
          onChange={(event) =>
            setForm((current) => ({ ...current, quotation_reference: event.target.value }))
          }
          placeholder="Example: SDS/PREM/2026/001"
          style={FIELD_STYLE}
        />
      </label>

      <label style={{ display: 'grid', gap: 7, marginTop: 14 }}>
        <span style={{ color: '#334155', fontWeight: 800, fontSize: 13 }}>
          External Payment / Invoice Link (optional)
        </span>
        <input
          type="url"
          value={form.payment_link}
          onChange={(event) =>
            setForm((current) => ({ ...current, payment_link: event.target.value }))
          }
          placeholder="Optional external payment or invoice URL"
          style={FIELD_STYLE}
        />
        <small style={{ color: '#64748b', lineHeight: 1.6 }}>
          The built-in Pay Premium Quotation button uses Razorpay. This field is only for an
          additional external link that you want the client to see.
        </small>
      </label>

      <label style={{ display: 'grid', gap: 7, marginTop: 14 }}>
        <span style={{ color: '#334155', fontWeight: 800, fontSize: 13 }}>Sales Note</span>
        <textarea
          value={form.sales_note}
          onChange={(event) =>
            setForm((current) => ({ ...current, sales_note: event.target.value }))
          }
          placeholder="Add follow-up note, quotation details or client discussion summary..."
          rows={4}
          style={{
            borderRadius: 14,
            border: '1px solid #cbd5e1',
            padding: 14,
            outline: 'none',
            resize: 'vertical',
            width: '100%',
            boxSizing: 'border-box',
          }}
        />
      </label>

      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          flexWrap: 'wrap',
          marginTop: 18,
        }}
      >
        <button
          type="submit"
          name="premium_action"
          value="draft"
          className="ghost"
          disabled={updating}
          style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', gap: 10 }}
        >
          {updating ? <Loader2 size={18} className="spin" /> : <Save size={18} />}
          {updating ? 'Saving...' : 'Save Draft'}
        </button>

        <button
          type="submit"
          name="premium_action"
          value="send_to_client"
          className="primary"
          disabled={updating || toNumber(form.quoted_amount, 0) <= 0}
          style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', gap: 10 }}
        >
          {updating ? <Loader2 size={18} className="spin" /> : <Send size={18} />}
          {updating
            ? 'Sending...'
            : isRevision
              ? 'Send Revised Quotation to Client Panel'
              : 'Send Quotation to Client Panel'}
        </button>

        <div style={{ color: '#64748b', fontSize: 13 }}>
          Quoted amount: {formatCurrency(form.quoted_amount, form.quoted_currency)}
        </div>

        {form.payment_link ? (
          <a
            href={form.payment_link}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              color: '#2563eb',
              fontWeight: 800,
              textDecoration: 'none',
            }}
          >
            Open link
            <ExternalLink size={14} />
          </a>
        ) : null}
      </div>
    </form>
  );
}

function RequestDetails({
  request,
  form,
  setForm,
  onUpdate,
  updating,
  revisionMode,
  setRevisionMode,
}) {
  if (!request) {
    return (
      <div
        className="premium-detail-empty"
        style={{
          borderRadius: 28,
          padding: 28,
          background: '#ffffff',
          border: '1px solid rgba(226,232,240,0.95)',
          boxShadow: '0 18px 45px rgba(15,23,42,0.06)',
          minHeight: 360,
          display: 'grid',
          placeItems: 'center',
          textAlign: 'center',
          color: '#64748b',
        }}
      >
        <div>
          <ClipboardList size={46} color="#94a3b8" />
          <h3 style={{ color: '#0f172a', marginBottom: 8 }}>Select a Premium request</h3>
          <p style={{ margin: 0, lineHeight: 1.7 }}>
            Choose a request to view quotation, payment, activation and follow-up details.
          </p>
        </div>
      </div>
    );
  }

  const requirements = request.requirements || {};
  const paid = isPaidRequest(request);
  const paymentPending = isPaymentPending(request);
  const alert = deriveRequestAlert(request);
  const notificationCount = toNumber(request.quotation_notification_count, 0);
  const employeeLimit = request.is_unlimited_employees
    ? 'Unlimited'
    : request.quoted_employee_limit === 0
      ? 'Unlimited'
      : safeText(request.quoted_employee_limit || requirements.employee_count);
  const showQuotationForm = !paid || revisionMode;

  return (
    <div
      className="premium-request-detail"
      style={{
        borderRadius: 28,
        padding: 24,
        background: '#ffffff',
        border: '1px solid rgba(226,232,240,0.95)',
        boxShadow: '0 18px 45px rgba(15,23,42,0.06)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 14,
          alignItems: 'flex-start',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <p
            style={{
              margin: '0 0 8px',
              color: '#2563eb',
              fontWeight: 900,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
              fontSize: 12,
            }}
          >
            {safeText(request.request_reference || requestId(request), 'Premium Request')}
          </p>
          <h2 style={{ margin: 0, color: '#0f172a' }}>
            {safeText(request.company_name, 'Company')}
          </h2>
          <p style={{ margin: '8px 0 0', color: '#64748b' }}>
            Premium custom quotation and subscription record
          </p>
        </div>

        <StatusBadge status={request.status || 'new'} />
      </div>

      <div style={{ marginTop: 18 }}>
        <AlertBanner alert={alert} />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 12,
          marginTop: 20,
        }}
      >
        <DetailItem icon={Building2} label="Company Email" value={safeText(request.company_email)} />
        <DetailItem icon={Users} label="Contact Person" value={safeText(request.requester_name)} />
        <DetailItem icon={Mail} label="Contact Email" value={safeText(request.requester_email)} />
        <DetailItem icon={Phone} label="Contact Phone" value={safeText(request.requester_phone)} />
        <DetailItem icon={IndianRupee} label="Recurring Amount" value={formatCurrency(request.renewal_amount || request.quoted_amount, request.quoted_currency)} tone={paid ? 'success' : 'default'} />
        <DetailItem icon={CalendarClock} label="Billing Interval" value={statusLabel(request.quoted_billing_interval || 'monthly')} />
        <DetailItem icon={Users} label="Employee Limit" value={employeeLimit} />
        <DetailItem icon={CreditCard} label="Payment Status" value={statusLabel(request.payment_status || (paid ? 'paid' : 'not paid'))} tone={paid ? 'success' : paymentPending ? 'warning' : 'default'} />
        <DetailItem icon={ShieldCheck} label="Client Visible" value={request.client_visible ? 'Yes' : 'No'} tone={request.client_visible ? 'info' : 'default'} />
        <DetailItem icon={CalendarClock} label="Payment Due Date" value={formatDate(request.payment_due_date, false)} tone={paymentPending ? 'warning' : 'default'} />
        <DetailItem icon={Clock3} label="Next Renewal Due" value={formatDate(request.next_due_date, false)} tone={paid ? 'success' : 'default'} />
        <DetailItem icon={CheckCircle2} label="Paid / Activated On" value={formatDate(request.paid_at)} tone={paid ? 'success' : 'default'} />
      </div>

      {request.client_visible ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
            gap: 12,
            marginTop: 14,
          }}
        >
          <DetailItem
            icon={Mail}
            label="Quotation Email"
            value={request.quotation_email_sent ? 'Sent successfully' : 'Not sent / failed'}
            tone={request.quotation_email_sent ? 'success' : 'warning'}
          />
          <DetailItem
            icon={BellRing}
            label="In-app Notifications"
            value={`${notificationCount} notification(s) created`}
            tone={notificationCount > 0 ? 'success' : 'warning'}
          />
          <DetailItem
            icon={FileText}
            label="Quotation Reference"
            value={safeText(request.quotation_reference || request.request_reference)}
          />
        </div>
      ) : null}

      {request.draft_revision_pending ? (
        <div style={{ marginTop: 14 }}>
          <AlertBanner
            alert={{
              level: 'warning',
              title: 'Unpublished quotation revision',
              message:
                'Internal quotation changes are saved, but the client still sees the last published quotation. Send the revised quotation when it is ready.',
            }}
          />
        </div>
      ) : null}

      <section
        style={{
          marginTop: 22,
          padding: 18,
          borderRadius: 22,
          background: 'linear-gradient(135deg, rgba(248,250,252,0.95), rgba(239,246,255,0.92))',
          border: '1px solid rgba(226,232,240,0.95)',
        }}
      >
        <h3 style={{ margin: '0 0 14px', color: '#0f172a' }}>Requirement Details</h3>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 12,
          }}
        >
          <DetailItem icon={Tag} label="Requested Plan" value={safeText(requirements.requested_plan || request.requested_plan_name || 'Premium')} />
          <DetailItem icon={ShieldCheck} label="Onboarding" value={requirementText(requirements, 'onboarding_required')} />
          <DetailItem icon={FileText} label="Training" value={requirementText(requirements, 'training_required')} />
          <DetailItem icon={MessageSquare} label="Support / SLA" value={requirementText(requirements, 'support_sla')} />
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ color: '#334155', fontWeight: 900, marginBottom: 8 }}>
            Custom Modules / Requirements
          </div>
          <div
            style={{
              borderRadius: 16,
              padding: 14,
              background: '#ffffff',
              border: '1px solid rgba(226,232,240,0.9)',
              color: '#475569',
              lineHeight: 1.7,
              whiteSpace: 'pre-wrap',
            }}
          >
            {requirementText(requirements, 'custom_modules', 'No custom module details provided.')}
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ color: '#334155', fontWeight: 900, marginBottom: 8 }}>
            Company Message
          </div>
          <div
            style={{
              borderRadius: 16,
              padding: 14,
              background: '#ffffff',
              border: '1px solid rgba(226,232,240,0.9)',
              color: '#475569',
              lineHeight: 1.7,
              whiteSpace: 'pre-wrap',
            }}
          >
            {safeText(request.message, 'No message provided.')}
          </div>
        </div>
      </section>

      {paid && !revisionMode ? (
        <section
          style={{
            marginTop: 22,
            padding: 18,
            borderRadius: 22,
            background: '#f0fdf4',
            border: '1px solid rgba(22,163,74,0.25)',
            color: '#166534',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 14,
              flexWrap: 'wrap',
            }}
          >
            <div>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 9 }}>
                <CheckCircle2 size={21} />
                Premium subscription is active
              </h3>
              <p style={{ margin: '8px 0 0', lineHeight: 1.7 }}>
                Quotation and payment action buttons are hidden because this subscription is paid.
                Use Revise Quotation only when changing the client-specific recurring price or renewal terms.
              </p>
            </div>

            <button
              type="button"
              className="ghost"
              onClick={() => setRevisionMode(true)}
              style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', gap: 9 }}
            >
              <PencilLine size={18} />
              Revise Quotation
            </button>
          </div>
        </section>
      ) : null}

      {paid && revisionMode ? (
        <div style={{ marginTop: 18 }}>
          <button
            type="button"
            className="ghost"
            disabled={updating}
            onClick={() => setRevisionMode(false)}
          >
            Cancel Revision
          </button>
        </div>
      ) : null}

      {showQuotationForm ? (
        <QuotationForm
          form={form}
          setForm={setForm}
          onUpdate={onUpdate}
          updating={updating}
          isRevision={paid}
        />
      ) : null}

      <HistoryList title="Quotation History" items={request.quotation_history} type="quotation" />
      <HistoryList title="Payment and Renewal History" items={request.payment_history} type="payment" />
    </div>
  );
}

export default function PremiumRequests({ setPage }) {
  const { showAlert } = useCustomAlert();
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [requests, setRequests] = useState([]);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [editForm, setEditForm] = useState(DEFAULT_EDIT_FORM);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [revisionMode, setRevisionMode] = useState(false);
  const [page, setPageNumber] = useState(1);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 12,
    total: 0,
    pages: 1,
  });

  const selectedId = requestId(selectedRequest);

  const stats = useMemo(() => {
    const total = pagination.total || requests.length;
    const actionRequired = requests.filter((item) =>
      ['error', 'warning'].includes(String(item.alert_level || '').toLowerCase()),
    ).length;
    const pendingPayment = requests.filter((item) => isPaymentPending(item)).length;
    const convertedCount = requests.filter((item) => isPaidRequest(item)).length;

    return { total, actionRequired, pendingPayment, convertedCount };
  }, [pagination.total, requests]);

  function buildEditForm(request = {}) {
    return {
      status: request.status || 'contacted',
      sales_note: request.sales_note || '',
      quoted_amount: request.renewal_amount ?? request.quoted_amount ?? '',
      quoted_currency: request.quoted_currency || 'INR',
      quoted_employee_limit: request.is_unlimited_employees
        ? 0
        : request.quoted_employee_limit ?? '',
      quoted_billing_interval: request.quoted_billing_interval || 'monthly',
      quotation_reference: request.quotation_reference || '',
      payment_link: request.payment_link || '',
      payment_due_date: dateInputValue(request.payment_due_date),
      quotation_valid_until: dateInputValue(request.quotation_valid_until),
      follow_up_date: dateInputValue(request.follow_up_date),
    };
  }

  function selectRequest(request) {
    setSelectedRequest(request);
    setEditForm(buildEditForm(request));
    setRevisionMode(false);
  }

  async function loadRequests(nextPage = page, nextFilters = filters) {
    setLoading(true);

    try {
      const data = await api(
        `/billing/admin/premium-requests${buildQuery({
          ...nextFilters,
          page: nextPage,
          limit: 12,
        })}`,
      );

      const items = Array.isArray(data.items) ? data.items : [];

      setRequests(items);
      setPagination({
        page: data.page || nextPage,
        limit: data.limit || 12,
        total: data.total || items.length,
        pages: data.pages || 1,
      });

      if (items.length) {
        const stillSelected = items.find((item) => requestId(item) === selectedId);
        selectRequest(stillSelected || items[0]);
      } else {
        setSelectedRequest(null);
        setEditForm(DEFAULT_EDIT_FORM);
        setRevisionMode(false);
      }
    } catch (error) {
      showAlert({
        title: 'Unable to load Premium requests',
        message: error.message || 'Please try again.',
        type: 'error',
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRequests(1, filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function applyFilters(event) {
    event.preventDefault();
    setPageNumber(1);
    await loadRequests(1, filters);
  }

  async function resetFilters() {
    setFilters(DEFAULT_FILTERS);
    setPageNumber(1);
    await loadRequests(1, DEFAULT_FILTERS);
  }

  async function goToPage(nextPage) {
    const safePage = Math.min(Math.max(nextPage, 1), pagination.pages || 1);
    setPageNumber(safePage);
    await loadRequests(safePage, filters);
  }

  async function updateRequest(event) {
    event.preventDefault();

    const submitAction = event.nativeEvent?.submitter?.value || 'draft';
    const sendToClient = submitAction === 'send_to_client';

    if (!selectedId) {
      showAlert({
        title: 'Select request',
        message: 'Please select a Premium request first.',
        type: 'warning',
      });
      return;
    }

    if (sendToClient && toNumber(editForm.quoted_amount, 0) <= 0) {
      showAlert({
        title: 'Quoted amount required',
        message: 'Enter a valid Premium quotation amount before sending it to the client.',
        type: 'warning',
      });
      return;
    }

    setUpdating(true);

    try {
      const payload = {
        status: editForm.status,
        sales_note: editForm.sales_note,
        quoted_amount:
          editForm.quoted_amount === '' ? '' : Number(editForm.quoted_amount || 0),
        quoted_currency: editForm.quoted_currency || 'INR',
        quoted_employee_limit:
          editForm.quoted_employee_limit === ''
            ? ''
            : Number(editForm.quoted_employee_limit || 0),
        quoted_billing_interval: editForm.quoted_billing_interval,
        quotation_reference: editForm.quotation_reference,
        payment_link: editForm.payment_link,
        payment_due_date: editForm.payment_due_date,
        quotation_valid_until: editForm.quotation_valid_until,
        follow_up_date: editForm.follow_up_date,
        send_to_client: sendToClient,
      };

      const data = await api(`/billing/admin/premium-requests/${selectedId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });

      const updated = data.request || {
        ...selectedRequest,
        ...payload,
      };

      setSelectedRequest(updated);
      setEditForm(buildEditForm(updated));
      setRequests((current) =>
        current.map((item) => (requestId(item) === selectedId ? updated : item)),
      );

      if (sendToClient) {
        setRevisionMode(false);
      }

      const notificationMessage = sendToClient
        ? `Email status: ${data.quotation_email_sent ? 'sent' : 'not confirmed'}. In-app notifications created: ${toNumber(data.quotation_notification_count, 0)}.`
        : 'The changes remain internal until the quotation is sent to the client panel.';

      showAlert({
        title: sendToClient ? 'Quotation sent to client panel' : 'Premium draft saved',
        message: `${data.message || 'Premium request updated successfully.'} ${notificationMessage}`,
        type: sendToClient && !data.quotation_email_sent ? 'warning' : 'success',
      });
    } catch (error) {
      showAlert({
        title: 'Unable to update request',
        message: error.message || 'Please try again.',
        type: 'error',
      });
    } finally {
      setUpdating(false);
    }
  }

  return (
    <main
      className="premium-requests-page"


      style={{
        padding: '28px min(4vw, 34px)',
        background:
          'radial-gradient(circle at top left, rgba(37,99,235,0.08), transparent 30%), linear-gradient(180deg, #f8fafc 0%, #ffffff 100%)',
        minHeight: '100vh',
      }}
    >
      <style>{`
        .premium-requests-page{
          --premium-ink:#101a3a;
          --premium-muted:#596483;
          --premium-primary:#6254da;
          --premium-deep:#342b78;
          --premium-blue:#3766db;
          --premium-teal:#18aaa8;
          --premium-green:#13736f;
          --premium-red:#b62f55;
          --premium-amber:#996400;
          --premium-flat-blue:#b9d7ff;
          --premium-flat-violet:#c9c0ff;
          --premium-flat-teal:#aee6d9;
          --premium-ease:cubic-bezier(.22,1,.36,1);

          min-height:100vh;
          padding:clamp(18px,3vw,34px)!important;
          background:
            radial-gradient(circle at top left,rgba(121,219,238,.14),transparent 28%),
            radial-gradient(circle at top right,rgba(191,190,249,.14),transparent 30%),
            linear-gradient(180deg,#f7fbff 0%,#ffffff 100%)!important;
          color:var(--premium-ink);
          font-family:var(--yc-ui,var(--body),inherit);
        }

        .premium-requests-page h1,
        .premium-requests-page h2,
        .premium-requests-page h3{
          color:var(--premium-ink)!important;
          font-family:var(--yc-display,var(--heading),inherit);
        }

        .premium-requests-page button{
          touch-action:manipulation;
          font-weight:900;
          transition:
            transform 240ms var(--premium-ease),
            box-shadow 240ms var(--premium-ease),
            border-color 200ms ease,
            background 200ms ease,
            color 200ms ease,
            filter 200ms ease;
        }

        .premium-requests-page button:hover:not(:disabled){
          transform:translateY(-2px);
          filter:saturate(1.04);
        }

        .premium-requests-page button:active:not(:disabled){
          transform:translateY(0) scale(.985);
        }

        .premium-requests-page button:disabled{
          cursor:not-allowed;
          opacity:.56;
          transform:none;
          filter:none;
        }

        .premium-requests-page .primary,
        .premium-requests-page .ghost{
          display:inline-flex;
          align-items:center;
          justify-content:center;
          gap:8px;
          min-height:43px;
          padding:0 14px;
          border-radius:13px;
          line-height:1;
          white-space:nowrap;
        }

        .premium-requests-page .primary{
          border:1px solid rgba(52,43,120,.16);
          color:#fff;
          background:linear-gradient(145deg,#4f72df,#2bb9b5);
          box-shadow:5px 6px 0 rgba(52,43,120,.8),0 12px 22px rgba(55,102,219,.16);
        }

        .premium-requests-page .ghost{
          border:1px solid rgba(98,84,218,.18);
          color:var(--premium-deep);
          background:#f1efff;
          box-shadow:3px 4px 0 rgba(98,84,218,.12);
        }

        .premium-requests-hero{
          position:relative;
          isolation:isolate;
          overflow:hidden;
          padding:clamp(24px,3vw,38px)!important;
          border:1px solid rgba(171,181,211,.72)!important;
          border-radius:clamp(28px,2.5vw,40px)!important;
          color:var(--premium-ink)!important;
          background:
            radial-gradient(circle at 8% 8%,rgba(121,219,238,.34),transparent 31%),
            radial-gradient(circle at 92% 12%,rgba(191,190,249,.30),transparent 34%),
            linear-gradient(135deg,#f1fbff 0%,#fffdf8 48%,#f8f2ff 100%)!important;
          box-shadow:
            12px 14px 0 var(--premium-flat-blue),
            0 28px 48px rgba(34,38,110,.13)!important;
        }

        .premium-requests-hero::before{
          content:"";
          position:absolute;
          inset:0;
          z-index:-2;
          opacity:.42;
          pointer-events:none;
          background-image:
            linear-gradient(rgba(65,55,161,.035) 1px,transparent 1px),
            linear-gradient(90deg,rgba(65,55,161,.035) 1px,transparent 1px);
          background-size:42px 42px;
        }

        .premium-requests-hero::after{
          content:"";
          position:absolute;
          z-index:-1;
          width:clamp(170px,21vw,300px);
          aspect-ratio:1;
          right:clamp(-120px,-8vw,-65px);
          top:clamp(-125px,-8vw,-70px);
          border:1px solid rgba(65,55,161,.12);
          border-radius:34% 66% 58% 42% / 44% 38% 62% 56%;
          background:linear-gradient(145deg,rgba(105,217,208,.72),rgba(121,189,242,.72));
          transform:rotate(18deg);
        }

        .premium-requests-hero h1{
          font-size:clamp(34px,4.4vw,62px)!important;
          font-weight:760;
          line-height:.95;
          letter-spacing:-.055em;
        }

        .premium-requests-hero p{
          color:var(--premium-muted)!important;
        }

        .premium-requests-hero>div:first-child>p:first-child{
          display:inline-flex!important;
          width:fit-content;
          padding:9px 13px;
          border-radius:999px;
          color:#fff!important;
          background:var(--premium-deep);
          font-size:9px!important;
          line-height:1;
          letter-spacing:.12em!important;
        }

        .premium-requests-hero .ghost{
          color:var(--premium-deep)!important;
          background:#f1efff!important;
          border-color:rgba(98,84,218,.18)!important;
        }

        .premium-requests-hero>div:last-child{
          margin-top:24px!important;
        }

        .premium-requests-hero>div:last-child>div{
          min-width:0;
          border:1px solid rgba(171,181,211,.66)!important;
          border-radius:19px!important;
          background:#f8fbff!important;
          box-shadow:5px 6px 0 rgba(185,215,255,.72),0 14px 24px rgba(34,38,110,.08);
        }

        .premium-requests-hero>div:last-child>div:nth-child(2){
          background:#fff4d5!important;
          box-shadow:5px 6px 0 #ffe0a5,0 14px 24px rgba(34,38,110,.08);
        }

        .premium-requests-hero>div:last-child>div:nth-child(3){
          background:#f1efff!important;
          box-shadow:5px 6px 0 var(--premium-flat-violet),0 14px 24px rgba(34,38,110,.08);
        }

        .premium-requests-hero>div:last-child>div:nth-child(4){
          background:#eaf8f4!important;
          box-shadow:5px 6px 0 var(--premium-flat-teal),0 14px 24px rgba(34,38,110,.08);
        }

        .premium-filter-bar{
          grid-template-columns:minmax(180px,240px) minmax(240px,1fr) auto auto!important;
          gap:12px!important;
          align-items:center!important;
          margin-bottom:22px!important;
          padding:17px!important;
          border:1px solid rgba(171,181,211,.7)!important;
          border-radius:22px!important;
          background:linear-gradient(145deg,rgba(237,248,255,.7),rgba(248,241,255,.62))!important;
          box-shadow:7px 9px 0 #d1dcfa,0 18px 30px rgba(34,38,110,.08)!important;
        }

        .premium-requests-page input,
        .premium-requests-page select,
        .premium-requests-page textarea{
          border:1px solid rgba(159,169,205,.62)!important;
          border-radius:14px!important;
          outline:none!important;
          color:var(--premium-ink)!important;
          background:rgba(255,255,255,.94)!important;
          transition:border-color 180ms ease,box-shadow 180ms ease,background 180ms ease;
        }

        .premium-requests-page input:hover,
        .premium-requests-page select:hover,
        .premium-requests-page textarea:hover{
          border-color:rgba(98,84,218,.34)!important;
        }

        .premium-requests-page input:focus,
        .premium-requests-page select:focus,
        .premium-requests-page textarea:focus{
          border-color:var(--premium-primary)!important;
          background:#fff!important;
          box-shadow:0 0 0 4px rgba(98,84,218,.11)!important;
        }

        .premium-workspace{
          grid-template-columns:minmax(300px,.88fr) minmax(0,1.45fr)!important;
          gap:20px!important;
          align-items:start!important;
        }

        .premium-request-card{
          border:1px solid rgba(171,181,211,.68)!important;
          border-radius:22px!important;
          background:linear-gradient(145deg,#fff,#f7fbff)!important;
          box-shadow:6px 8px 0 rgba(185,215,255,.72),0 18px 28px rgba(34,38,110,.08)!important;
          transition:
            transform 260ms var(--premium-ease),
            border-color 220ms ease,
            box-shadow 260ms var(--premium-ease)!important;
        }

        .premium-request-card:hover{
          transform:translateY(-3px)!important;
          border-color:rgba(98,84,218,.32)!important;
        }

        .premium-request-card.selected{
          border-color:rgba(98,84,218,.46)!important;
          background:
            radial-gradient(circle at 100% 0%,rgba(105,217,208,.18),transparent 35%),
            linear-gradient(145deg,#f1efff,#f7fbff)!important;
          box-shadow:7px 9px 0 var(--premium-flat-violet),0 20px 34px rgba(34,38,110,.12)!important;
        }

        .premium-request-detail,
        .premium-detail-empty{
          border:1px solid rgba(171,181,211,.72)!important;
          border-radius:28px!important;
          background:linear-gradient(145deg,#fff,#f7fbff)!important;
          box-shadow:9px 11px 0 #d1dcfa,0 24px 42px rgba(34,38,110,.10)!important;
        }

        .premium-request-detail{
          position:sticky;
          top:18px;
          max-height:calc(100vh - 36px);
          overflow:auto;
          scrollbar-width:thin;
          scrollbar-color:rgba(98,84,218,.35) transparent;
        }

        .premium-request-detail::-webkit-scrollbar{
          width:8px;
        }

        .premium-request-detail::-webkit-scrollbar-thumb{
          border-radius:999px;
          background:rgba(98,84,218,.35);
        }

        .premium-history-section{
          border:1px solid rgba(171,181,211,.64)!important;
          border-radius:22px!important;
          background:linear-gradient(145deg,rgba(237,248,255,.62),rgba(248,241,255,.56))!important;
        }

        .premium-history-section>div>div{
          border-color:rgba(98,84,218,.09)!important;
          border-radius:16px!important;
          background:rgba(255,255,255,.88)!important;
        }

        .premium-quotation-form{
          margin-top:22px!important;
          padding:20px;
          border:1px solid rgba(171,181,211,.66);
          border-radius:22px;
          background:
            radial-gradient(circle at 100% 0%,rgba(105,217,208,.11),transparent 35%),
            linear-gradient(145deg,#f4fbff,#f8f1ff);
          box-shadow:6px 8px 0 rgba(185,215,255,.58),0 16px 26px rgba(34,38,110,.07);
        }

        .premium-quotation-form label span{
          color:#334164!important;
          font-weight:900!important;
        }

        .premium-requests-page .spin{
          animation:premiumSpin .8s linear infinite;
        }

        @keyframes premiumSpin{
          to{transform:rotate(360deg)}
        }

        @media (max-width:980px){
          .premium-workspace{
            grid-template-columns:1fr!important;
          }

          .premium-request-detail{
            position:static;
            max-height:none;
            overflow:visible;
          }
        }

        @media (max-width:760px){
          .premium-requests-page{
            padding:14px!important;
          }

          .premium-requests-hero{
            padding:20px!important;
            border-radius:24px!important;
            box-shadow:7px 8px 0 var(--premium-flat-blue),0 18px 30px rgba(34,38,110,.1)!important;
          }

          .premium-requests-hero>div:first-child{
            flex-direction:column;
            align-items:flex-start!important;
          }

          .premium-requests-hero>div:first-child>div:last-child{
            width:100%;
          }

          .premium-requests-hero button{
            width:100%;
          }

          .premium-filter-bar{
            grid-template-columns:1fr!important;
            padding:15px!important;
          }

          .premium-filter-bar button{
            width:100%;
          }

          .premium-request-detail,
          .premium-detail-empty{
            padding:18px!important;
            border-radius:22px!important;
            box-shadow:6px 7px 0 #d1dcfa,0 16px 28px rgba(34,38,110,.08)!important;
          }

          .premium-history-section{
            overflow-x:auto;
          }

          .premium-quotation-form{
            padding:16px;
          }
        }

        @media (max-width:430px){
          .premium-requests-page{
            padding:10px!important;
          }

          .premium-requests-page .primary,
          .premium-requests-page .ghost{
            width:100%;
          }
        }

        @media (prefers-reduced-motion:reduce){
          .premium-requests-page *,
          .premium-requests-page *::before,
          .premium-requests-page *::after{
            animation-duration:.01ms!important;
            animation-iteration-count:1!important;
            transition-duration:.01ms!important;
            scroll-behavior:auto!important;
          }
        }
      `}</style>
      <section
        className="premium-requests-hero"
        style={{
          borderRadius: 30,
          padding: 26,
          background:
            'linear-gradient(135deg, rgba(15,23,42,0.96), rgba(30,64,175,0.92), rgba(20,184,166,0.82))',
          color: '#ffffff',
          boxShadow: '0 24px 70px rgba(15,23,42,0.22)',
          marginBottom: 24,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 18,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <div>
            <p
              style={{
                margin: '0 0 10px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                color: '#bfdbfe',
                fontWeight: 900,
                letterSpacing: 0.5,
                textTransform: 'uppercase',
                fontSize: 12,
              }}
            >
              <ShieldCheck size={16} />
              Superadmin Premium Sales Desk
            </p>
            <h1 style={{ margin: 0, fontSize: 'clamp(28px, 4vw, 44px)' }}>
              Premium Requests
            </h1>
            <p style={{ margin: '12px 0 0', maxWidth: 780, color: '#dbeafe', lineHeight: 1.7 }}>
              Track Premium quotations, payment deadlines, email and in-app delivery, activation
              status and client-specific recurring renewal pricing.
            </p>
          </div>

          <button
            type="button"
            className="ghost"
            onClick={() => loadRequests(page, filters)}
            disabled={loading}
            style={{
              minHeight: 44,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              background: 'rgba(255,255,255,0.12)',
              color: '#ffffff',
              border: '1px solid rgba(255,255,255,0.22)',
            }}
          >
            {loading ? <Loader2 size={18} className="spin" /> : <RefreshCw size={18} />}
            Refresh
          </button>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 14,
            marginTop: 24,
          }}
        >
          <DetailItem icon={ClipboardList} label="Total Requests" value={stats.total} />
          <DetailItem icon={AlertTriangle} label="Action Required" value={stats.actionRequired} tone={stats.actionRequired ? 'warning' : 'success'} />
          <DetailItem icon={CreditCard} label="Payment Pending" value={stats.pendingPayment} tone={stats.pendingPayment ? 'warning' : 'default'} />
          <DetailItem icon={CheckCircle2} label="Converted In View" value={stats.convertedCount} tone="success" />
        </div>
      </section>

      {stats.actionRequired > 0 ? (
        <div style={{ marginBottom: 18 }}>
          <AlertBanner
            alert={{
              level: 'warning',
              title: `${stats.actionRequired} Premium request(s) need attention`,
              message:
                'Open the highlighted requests to review overdue payments, pending follow-ups or quotation delivery issues.',
            }}
          />
        </div>
      ) : null}

      <form
        className="premium-filter-bar"
        onSubmit={applyFilters}
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(180px, 240px) minmax(240px, 1fr) auto auto',
          gap: 12,
          alignItems: 'center',
          marginBottom: 20,
          background: '#ffffff',
          border: '1px solid rgba(226,232,240,0.95)',
          borderRadius: 22,
          padding: 16,
          boxShadow: '0 12px 30px rgba(15,23,42,0.05)',
        }}
      >
        <select
          value={filters.status}
          onChange={(event) =>
            setFilters((current) => ({ ...current, status: event.target.value }))
          }
          style={FIELD_STYLE}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <div style={{ position: 'relative' }}>
          <Search
            size={17}
            style={{
              position: 'absolute',
              left: 14,
              top: '50%',
              transform: 'translateY(-50%)',
              color: '#94a3b8',
            }}
          />
          <input
            type="search"
            value={filters.search}
            onChange={(event) =>
              setFilters((current) => ({ ...current, search: event.target.value }))
            }
            placeholder="Search company, email, phone or request reference..."
            style={{ ...FIELD_STYLE, paddingLeft: 42 }}
          />
        </div>

        <button type="submit" className="primary" style={{ minHeight: 44 }}>
          Search
        </button>

        <button type="button" className="ghost" onClick={resetFilters} style={{ minHeight: 44 }}>
          Reset
        </button>
      </form>

      <section
        className="premium-workspace"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(310px, 0.9fr) minmax(0, 1.45fr)',
          gap: 20,
          alignItems: 'start',
        }}
      >
        <div style={{ display: 'grid', gap: 14 }}>
          {loading ? (
            <div
              style={{
                borderRadius: 24,
                padding: 30,
                background: '#ffffff',
                border: '1px solid rgba(226,232,240,0.95)',
                display: 'grid',
                placeItems: 'center',
                color: '#64748b',
              }}
            >
              <Loader2 size={30} className="spin" />
              <p style={{ margin: '12px 0 0' }}>Loading Premium requests...</p>
            </div>
          ) : requests.length ? (
            requests.map((request) => (
              <RequestCard
                key={requestId(request)}
                request={request}
                selected={requestId(request) === selectedId}
                onSelect={selectRequest}
              />
            ))
          ) : (
            <div
              style={{
                borderRadius: 24,
                padding: 30,
                background: '#ffffff',
                border: '1px solid rgba(226,232,240,0.95)',
                color: '#64748b',
                textAlign: 'center',
              }}
            >
              <AlertTriangle size={34} color="#f59e0b" />
              <h3 style={{ color: '#0f172a', marginBottom: 8 }}>No Premium requests found</h3>
              <p style={{ margin: 0 }}>Try another status filter or search keyword.</p>
            </div>
          )}

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 10,
              alignItems: 'center',
              background: '#ffffff',
              border: '1px solid rgba(226,232,240,0.95)',
              borderRadius: 18,
              padding: 12,
              color: '#64748b',
            }}
          >
            <button
              type="button"
              className="ghost"
              disabled={pagination.page <= 1 || loading}
              onClick={() => goToPage((pagination.page || 1) - 1)}
            >
              Previous
            </button>

            <span style={{ fontWeight: 800 }}>
              Page {pagination.page || 1} of {pagination.pages || 1}
            </span>

            <button
              type="button"
              className="ghost"
              disabled={(pagination.page || 1) >= (pagination.pages || 1) || loading}
              onClick={() => goToPage((pagination.page || 1) + 1)}
            >
              Next
            </button>
          </div>
        </div>

        <RequestDetails
          request={selectedRequest}
          form={editForm}
          setForm={setEditForm}
          onUpdate={updateRequest}
          updating={updating}
          revisionMode={revisionMode}
          setRevisionMode={setRevisionMode}
        />
      </section>

      <section
        style={{
          marginTop: 22,
          padding: 18,
          borderRadius: 22,
          background: '#eff6ff',
          border: '1px solid rgba(37,99,235,0.24)',
          color: '#1e3a8a',
          lineHeight: 1.7,
        }}
      >
        <strong>Premium billing rule:</strong> Save Draft is internal. Sending a quotation makes
        it client-visible and enables Razorpay payment using the stored custom quote. After
        successful payment, quotation actions are hidden; they return only through the explicit
        Revise Quotation action.
      </section>

      {typeof setPage === 'function' ? (
        <button
          type="button"
          onClick={() => setPage('subscriptions')}
          className="ghost"
          style={{
            marginTop: 18,
            minHeight: 44,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          Back to Subscriptions
        </button>
      ) : null}
    </main>
  );
}