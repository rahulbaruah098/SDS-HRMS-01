import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Inbox,
  Loader2,
  Megaphone,
  RefreshCw,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  api,
  currentUser,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../api/client';
import { canCreateNotifications } from '../data/modules';

const NOTIFICATION_NOTICE_HIDE_MS = 3600;
const EMPTY_FORM = {
  title: '',
  body: '',
  priority: 'normal',
  notification_type: 'general',
  show_popup: true,

  target_scope: 'tenant',
  target_tenant_id: '',
  department_id: '',
  team_owner_id: '',
  team_type: '',
  user_ids: [],
};

const EMPTY_OPTIONS = {
  can_create: false,
  can_create_global: false,
  current_tenant_id: '',
  tenants: [],
  users: [],
  departments: [],
  teams: [],
  target_options: [],
};

function formatDate(value) {
  if (!value) return '—';

  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString();
  } catch {
    return String(value);
  }
}

function displayValue(value, fallback = '—') {
  const text = String(value || '').trim();
  return text || fallback;
}

function notificationStatusLabel(item = {}) {
  if (item.read === true || item.status === 'read') {
    return 'Read';
  }

  return 'Unread';
}

function notificationTargetLabel(item = {}) {
  return item.tenant_name || item.tenant_id || 'This Tenant';
}

function priorityClass(priority = '') {
  const value = String(priority || '').toLowerCase();

  if (value === 'high' || value === 'urgent') {
    return 'notif-pill-red';
  }

  if (value === 'low') {
    return 'notif-pill-gray';
  }

  return 'notif-pill-blue';
}


function isPlatformNotification(item = {}) {
  const meta = item.meta || {};
  const notificationType = String(
    item.notification_type ||
      item.type ||
      meta.notification_type ||
      meta.type ||
      '',
  )
    .trim()
    .toLowerCase();

  return Boolean(
    item.platform_notification === true ||
      meta.platform_notification === true ||
      notificationType.startsWith('platform_'),
  );
}

function getNotificationAction(item = {}) {
  const meta = item.meta || {};
  const target = String(
    meta.target ||
      meta.page ||
      item.target ||
      item.page ||
      '',
  )
    .trim()
    .toLowerCase()
    .replaceAll('-', '_');

  if (isPlatformNotification(item)) {
    const action = item.action || {};
    const actionTarget = String(
      item.action_page ||
        item.action_target ||
        action.page ||
        action.target ||
        meta.action_page ||
        meta.action_target ||
        item.web_page ||
        meta.web_page ||
        target,
    )
      .trim()
      .toLowerCase()
      .replaceAll('-', '_')
      .replaceAll(' ', '_');

    const platformPageMap = {
      company: 'companies',
      companies: 'companies',
      tenant: 'companies',
      tenants: 'companies',

      trial_request: 'demo_requests',
      trial_requests: 'demo_requests',
      demo_request: 'demo_requests',
      demo_requests: 'demo_requests',

      premium_request: 'premium_requests',
      premium_requests: 'premium_requests',
      premium_plan_request: 'premium_requests',
      premium_plan_requests: 'premium_requests',

      billing: 'subscriptions',
      subscription: 'subscriptions',
      subscriptions: 'subscriptions',
      payment: 'subscriptions',
      payments: 'subscriptions',
      order: 'subscriptions',
      orders: 'subscriptions',
      payment_orders: 'subscriptions',
    };

    const page = platformPageMap[actionTarget];

    if (page) {
      const defaultLabels = {
        companies: 'Open Companies',
        demo_requests: 'Open Trial Requests',
        premium_requests: 'Open Premium Requests',
        subscriptions: 'Open Billing & Subscriptions',
      };

      return {
        page,
        label:
          item.action_label ||
          action.label ||
          meta.action_label ||
          defaultLabels[page],
      };
    }
  }

  if (target === 'billing' || target === 'upgrade' || target === 'subscribe') {
    return {
      page: 'billing',
      label: 'Open Billing',
    };
  }

  if (
    target === 'subscription_expired' ||
    target === 'trial_expired' ||
    target === 'demo_expired'
  ) {
    return {
      page: 'subscription_expired',
      label: 'View Expiry Details',
    };
  }

  if (item.notification_type === 'saas_trial_reminder') {
    return {
      page: 'billing',
      label: 'Upgrade Plan',
    };
  }

  return null;
}

function optionValue(item = {}) {
  return String(item.value || item._id || item.id || item.tenant_id || '').trim();
}

function optionLabel(item = {}) {
  return String(
    item.label ||
    item.name ||
    item.full_name ||
    item.employee_name ||
    item.email ||
    item.company_name ||
    item.tenant_name ||
    item.tenant_id ||
    item.value ||
    'Option',
  ).trim();
}

function userOptionLabel(user = {}) {
  const name = user.name || user.full_name || user.employee_name || user.email || 'Employee';
  const dept = user.department_name || user.department || '';
  const email = user.email || user.official_email || '';

  return [name, dept, email].filter(Boolean).join(' • ');
}

function TextInput({
  label,
  name,
  value,
  onChange,
  required = false,
  placeholder = '',
  type = 'text',
}) {
  return (
    <label className="notif-field">
      <span>
        {label}
        {required ? <b>*</b> : null}
      </span>
      <input
        type={type}
        name={name}
        value={value || ''}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
      />
    </label>
  );
}

function TextAreaInput({
  label,
  name,
  value,
  onChange,
  required = false,
  placeholder = '',
}) {
  return (
    <label className="notif-field notif-field-full">
      <span>
        {label}
        {required ? <b>*</b> : null}
      </span>
      <textarea
        name={name}
        value={value || ''}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        rows={5}
      />
    </label>
  );
}

function SelectInput({
  label,
  name,
  value,
  onChange,
  options = [],
  required = false,
}) {
  return (
    <label className="notif-field">
      <span>
        {label}
        {required ? <b>*</b> : null}
      </span>
      <select
        name={name}
        value={value || ''}
        onChange={onChange}
        required={required}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}


function MultiSelectInput({
  label,
  name,
  value = [],
  onChange,
  options = [],
  required = false,
  helper = '',
}) {
  const selectedValues = Array.isArray(value) ? value : [];

  return (
    <label className="notif-field notif-field-full">
      <span>
        {label}
        {required ? <b>*</b> : null}
      </span>

      <select
        name={name}
        value={selectedValues}
        multiple
        onChange={(event) => {
          const nextValues = Array.from(event.target.selectedOptions).map(
            (option) => option.value,
          );

          onChange({
            target: {
              name,
              value: nextValues,
              type: 'multiselect',
            },
          });
        }}
        required={required}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {helper ? <small className="notif-helper-text">{helper}</small> : null}
    </label>
  );
}


function notificationFeedbackScope(item = {}) {
  const key =
    item._id ||
    item.id ||
    item.created_at ||
    item.title ||
    item.notification_type ||
    'notification';

  return `notification:${String(key)}`;
}

function NotificationInlineMessage({ feedback, onClose, className = '' }) {
  if (!feedback?.message) return null;

  return (
    <div
      className={`notif-inline-feedback ${feedback.type || 'info'} ${className}`.trim()}
      role="status"
    >
      <span className="notif-inline-feedback-icon">
        {feedback.loading ? (
          <Loader2 size={15} className="notif-inline-spin" />
        ) : feedback.type === 'success' ? (
          <CheckCircle2 size={15} />
        ) : feedback.type === 'error' || feedback.type === 'warning' ? (
          <AlertTriangle size={15} />
        ) : (
          <ShieldCheck size={15} />
        )}
      </span>

      <span className="notif-inline-feedback-copy">
        {feedback.title ? <strong>{feedback.title}</strong> : null}
        <span>{feedback.message}</span>
      </span>

      <button
        type="button"
        className="notif-inline-feedback-close"
        onClick={onClose}
        aria-label="Dismiss notification"
      >
        <X size={13} />
      </button>
    </div>
  );
}

function NotificationConfirmPopup({ popup, onConfirm, onCancel }) {
  if (!popup || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      className="notif-confirm-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <section
        className="notif-confirm-popup"
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-confirm-title"
      >
        <header className="notif-confirm-header">
          <div className="notif-confirm-icon">
            <ShieldCheck size={22} />
          </div>

          <div className="notif-confirm-heading">
            <span>Notification Center</span>
            <h3 id="notification-confirm-title">{popup.title || 'Confirm Action'}</h3>
          </div>

          <button
            type="button"
            className="notif-confirm-close"
            onClick={onCancel}
            aria-label="Close confirmation"
          >
            <X size={18} />
          </button>
        </header>

        <div className="notif-confirm-body">
          <p>{popup.message || 'Are you sure you want to continue?'}</p>
        </div>

        <footer className="notif-confirm-footer">
          <button type="button" className="notif-confirm-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="notif-confirm-submit" onClick={onConfirm}>
            {popup.confirmLabel || 'Confirm'}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function NotificationCard({
  item,
  onMarkRead,
  onNavigate,
  feedback,
  onFeedbackClose,
}) {
  const isUnread = item.read !== true && item.status !== 'read';
  const action = getNotificationAction(item);
  const platformNotification = isPlatformNotification(item);
  const priority = displayValue(item.priority, 'normal');
  const notificationType = displayValue(item.notification_type, 'general');

  return (
    <article className={`notif-record-card ${isUnread ? 'unread' : ''}`}>
      <header className="notif-record-header">
        <div className="notif-record-identity">
          <span className="notif-record-avatar" aria-hidden="true">
            <BellRing size={22} />
          </span>

          <div className="notif-record-title">
            <h3>{displayValue(item.title, 'Notification')}</h3>
            <p>{displayValue(item.created_by_name || item.sender_name, 'System')}</p>
            <small>{formatDate(item.created_at)}</small>
          </div>
        </div>

        <div className="notif-record-status">
          <span className={`notif-pill ${isUnread ? 'notif-pill-green' : 'notif-pill-gray'}`}>
            {notificationStatusLabel(item)}
          </span>

          <span className={`notif-pill ${priorityClass(item.priority)}`}>
            {priority}
          </span>

          {platformNotification ? (
            <span className="notif-pill notif-pill-blue">Platform</span>
          ) : null}
        </div>
      </header>

      <div className="notif-record-body">
        <section className="notif-record-panel notif-record-message-panel">
          <span className="notif-record-panel-label">Notification message</span>
          <p>{displayValue(item.body || item.message, 'No message recorded.')}</p>
        </section>

        <section className="notif-record-panel">
          <span className="notif-record-panel-label">Delivery & classification</span>

          <dl className="notif-record-details">
            <div>
              <dt>Tenant / audience</dt>
              <dd>{notificationTargetLabel(item)}</dd>
            </div>
            <div>
              <dt>Notification type</dt>
              <dd>{notificationType}</dd>
            </div>
            <div>
              <dt>Popup enabled</dt>
              <dd>{item.show_popup === false ? 'No' : 'Yes'}</dd>
            </div>
          </dl>
        </section>

        <section className="notif-record-panel">
          <span className="notif-record-panel-label">Notification record</span>

          <dl className="notif-record-details">
            <div>
              <dt>Status</dt>
              <dd>{notificationStatusLabel(item)}</dd>
            </div>
            <div>
              <dt>Priority</dt>
              <dd>{priority}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{formatDate(item.created_at)}</dd>
            </div>
          </dl>
        </section>
      </div>

      <footer className="notif-record-footer">
        <div className="notif-record-control-copy">
          <span>Notification Control</span>
          <strong>{notificationTargetLabel(item)}</strong>
        </div>

        <div className="notif-record-action-stack">
          <div className="notif-card-actions">
            {action ? (
              <button
                type="button"
                className="notif-primary-btn"
                onClick={() => onNavigate(action.page)}
              >
                {action.label}
              </button>
            ) : null}

            {isUnread ? (
              <button
                type="button"
                className="notif-soft-btn"
                onClick={() => onMarkRead(item)}
                disabled={Boolean(feedback?.loading)}
              >
                Mark Read
              </button>
            ) : null}
          </div>

          <NotificationInlineMessage
            feedback={feedback}
            onClose={onFeedbackClose}
            className="notif-record-action-feedback"
          />
        </div>
      </footer>
    </article>
  );
}


// SaaS trial notifications use 15-day full-access trial wording.
export default function Notifications({ setPage } = {}) {
  const user = currentUser();
  const canCreate = canCreateNotifications(user);

  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [options, setOptions] = useState(EMPTY_OPTIONS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [filters, setFilters] = useState({
    q: '',
    unread: '',
    limit: 100,
  });
  const [appliedFilters, setAppliedFilters] = useState({
    q: '',
    unread: '',
    limit: 100,
  });

  const [form, setForm] = useState(EMPTY_FORM);
  const [activeSection, setActiveSection] = useState('notifications');
  const [inlineFeedback, setInlineFeedback] = useState({});
  const inlineFeedbackTimersRef = useRef({});
  const [confirmPopup, setConfirmPopup] = useState(null);
  const confirmResolverRef = useRef(null);


  const filteredItems = useMemo(() => {
    const q = String(appliedFilters.q || '').trim().toLowerCase();

    if (!q) {
      return items;
    }

    return items.filter((item) => {
      const values = [
        item.title,
        item.body,
        item.message,
        item.priority,
        item.notification_type,
        item.tenant_id,
        item.tenant_name,
        item.company_name,
        item.action_label,
        item.action_page,
        item.created_by_name,
      ];

      return values
        .map((value) => String(value || '').toLowerCase())
        .some((value) => value.includes(q));
    });
  }, [items, appliedFilters.q]);

  const stats = useMemo(() => {
    const unread = items.filter((item) => item.read !== true && item.status !== 'read').length;
    const popup = items.filter((item) => item.show_popup !== false).length;

    return {
      total: items.length,
      unread,
      popup,
    };
  }, [items]);


  const targetOptions = useMemo(() => {
    const backendOptions = Array.isArray(options.target_options)
      ? options.target_options
      : [];

    if (backendOptions.length) {
      return backendOptions;
    }

    return [
      { value: 'tenant', label: 'All Employees of This Tenant' },
      { value: 'department', label: 'Specific Department' },
      { value: 'team', label: 'Specific Team' },
      { value: 'selected_users', label: 'Selected Employees' },
      ...(options.can_create_global
        ? [
            { value: 'all_tenants', label: 'All Tenants' },
            { value: 'selected_tenant', label: 'Selected Tenant' },
          ]
        : []),
    ];
  }, [options]);

  const tenantOptions = useMemo(() => {
    return (options.tenants || [])
      .map((tenant) => ({
        value: tenant.tenant_id || tenant._id || tenant.id,
        label: tenant.name || tenant.company_name || tenant.tenant_name || tenant.tenant_id,
      }))
      .filter((item) => item.value);
  }, [options.tenants]);

  const departmentOptions = useMemo(() => {
    return (options.departments || [])
      .map((department) => ({
        value: optionValue(department),
        label: optionLabel(department),
      }))
      .filter((item) => item.value);
  }, [options.departments]);

  const teamOptions = useMemo(() => {
    return (options.teams || [])
      .map((team) => ({
        value: optionValue(team),
        label: [
          optionLabel(team),
          team.department ? `Department: ${team.department}` : '',
          team.is_reporting_officer ? 'RO' : '',
          team.is_team_leader ? 'TL' : '',
        ]
          .filter(Boolean)
          .join(' • '),
      }))
      .filter((item) => item.value);
  }, [options.teams]);

  const userOptions = useMemo(() => {
    return (options.users || [])
      .map((targetUser) => ({
        value: targetUser._id || targetUser.id || targetUser.employee_id || targetUser.email,
        label: userOptionLabel(targetUser),
      }))
      .filter((item) => item.value);
  }, [options.users]);

  const clearInlineFeedback = (scope) => {
    if (!scope) return;

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
  };

  const showInlineFeedback = (
    scope,
    type,
    message,
    title = '',
    options = {},
  ) => {
    if (!scope) return;

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
      }, NOTIFICATION_NOTICE_HIDE_MS);
    }
  };

  const showMessage = (
    type,
    message,
    title = '',
    scope = 'general',
    options = {},
  ) => {
    showInlineFeedback(
      scope,
      type,
      message || 'Notification action completed.',
      title || 'Notification Center',
      options,
    );
  };

  const showConfirm = (options = {}) =>
    new Promise((resolve) => {
      if (confirmResolverRef.current) {
        confirmResolverRef.current(false);
      }

      confirmResolverRef.current = resolve;
      setConfirmPopup({
        title: options.title || 'Confirm Action',
        message: options.message || 'Are you sure you want to continue?',
        confirmLabel: options.confirmLabel || 'Confirm',
      });
    });

  const resolveConfirm = (confirmed) => {
    const resolver = confirmResolverRef.current;
    confirmResolverRef.current = null;
    setConfirmPopup(null);

    if (resolver) {
      resolver(Boolean(confirmed));
    }
  };

  const loadNotifications = async ({
    feedbackScope = '',
    silent = false,
    filterValues = appliedFilters,
    feedbackMode = '',
  } = {}) => {
    if (!silent) {
      setLoading(true);
    }

    const mode =
      feedbackMode ||
      (feedbackScope === 'refresh' ? 'refresh' : 'filter');

    if (feedbackScope) {
      const loadingCopies = {
        refresh: [
          'Refreshing Notifications',
          'Checking for the latest notifications...',
        ],
        reset: [
          'Resetting Filters',
          'Restoring the default notification filters...',
        ],
        filter: [
          'Applying Filters',
          'Applying the selected notification filters...',
        ],
      };
      const loadingCopy = loadingCopies[mode] || loadingCopies.filter;

      showMessage(
        'info',
        loadingCopy[1],
        loadingCopy[0],
        feedbackScope,
        { loading: true },
      );
    }

    try {
      const params = {
        limit: filterValues.limit || 100,
      };

      if (filterValues.unread === 'true') {
        params.unread = true;
      }

      const data = await getNotifications(params);

      setItems(data.items || []);
      setUnreadCount(Number(data.unread_count || 0));

      if (feedbackScope) {
        const successCopies = {
          refresh: [
            'Notifications Refreshed',
            'The latest notifications have been loaded successfully.',
          ],
          reset: [
            'Filters Reset',
            'The default notification filters have been restored.',
          ],
          filter: [
            'Filters Applied',
            'Notification filters were applied successfully.',
          ],
        };
        const successCopy = successCopies[mode] || successCopies.filter;

        showMessage(
          'success',
          successCopy[1],
          successCopy[0],
          feedbackScope,
        );
      }
    } catch (error) {
      showMessage(
        'error',
        error.message || 'Unable to load notifications.',
        'Notifications Load Failed',
        feedbackScope || 'refresh',
      );
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  const loadNotificationOptions = async () => {
    if (!canCreate) {
      setOptions(EMPTY_OPTIONS);
      return;
    }

    try {
      const data = await api('/notifications/options');

      setOptions({
        ...EMPTY_OPTIONS,
        ...data,
        tenants: data.tenants || [],
        users: data.users || [],
        departments: data.departments || [],
        teams: data.teams || [],
        target_options: data.target_options || [],
      });
    } catch (error) {
      setOptions(EMPTY_OPTIONS);
      showMessage('error', error.message || 'Unable to load notification target options.', 'Target Options Load Failed', 'create');
    }
  };


  useEffect(() => {
    loadNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  useEffect(() => {
    loadNotificationOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCreate]);

  useEffect(() => {
    return () => {
      Object.values(inlineFeedbackTimersRef.current).forEach((timer) => {
        window.clearTimeout(timer);
      });

      inlineFeedbackTimersRef.current = {};

      if (confirmResolverRef.current) {
        confirmResolverRef.current(false);
        confirmResolverRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const dismissInlineFeedback = () => {
      Object.values(inlineFeedbackTimersRef.current).forEach((timer) => {
        window.clearTimeout(timer);
      });

      inlineFeedbackTimersRef.current = {};
      setInlineFeedback({});
    };

    document.addEventListener('pointerdown', dismissInlineFeedback);

    return () => {
      document.removeEventListener('pointerdown', dismissInlineFeedback);
    };
  }, []);

  useEffect(() => {
    if (!confirmPopup || typeof document === 'undefined') {
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
      const popup = document.querySelector('.notif-confirm-popup');

      if (popup && popup.contains(event.target)) {
        return;
      }

      event.preventDefault();
    };

    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        resolveConfirm(false);
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
  }, [confirmPopup]);

  const handleFilterChange = (event) => {
    const { name, value } = event.target;

    setFilters((previous) => ({
      ...previous,
      [name]: value,
    }));
  };

  const handleApplyFilters = async () => {
    const nextFilters = {
      q: String(filters.q || '').trim(),
      unread: filters.unread || '',
      limit: filters.limit || 100,
    };

    setAppliedFilters(nextFilters);

    await loadNotifications({
      feedbackScope: 'filter',
      silent: true,
      filterValues: nextFilters,
      feedbackMode: 'filter',
    });
  };

  const handleResetFilters = async () => {
    const resetFilters = {
      q: '',
      unread: '',
      limit: 100,
    };

    setFilters(resetFilters);
    setAppliedFilters(resetFilters);

    await loadNotifications({
      feedbackScope: 'filter',
      silent: true,
      filterValues: resetFilters,
      feedbackMode: 'reset',
    });
  };

  const handleFormChange = (event) => {
    const { name, value, type, checked } = event.target;

    setForm((previous) => {
      const nextValue = type === 'checkbox' ? checked : value;

      if (name === 'target_scope') {
        return {
          ...previous,
          target_scope: nextValue,
          target_tenant_id: '',
          department_id: '',
          team_owner_id: '',
          team_type: '',
          user_ids: [],
        };
      }

      return {
        ...previous,
        [name]: nextValue,
      };
    });
  };

  const resetForm = () => {
    setForm({ ...EMPTY_FORM });
  };

  const handleResetForm = () => {
    resetForm();
    showMessage(
      'success',
      'The notification form has been reset.',
      'Form Reset',
      'create',
    );
  };

  const handleCreateNotification = async (event) => {
    event.preventDefault();

    if (!canCreate) {
      showMessage('error', 'You do not have permission to create notifications.', 'Permission Denied', 'create');
      return;
    }

    const title = String(form.title || '').trim();
    const body = String(form.body || '').trim();

    if (!title) {
      showMessage('warning', 'Notification title is required.', 'Missing Title', 'create');
      return;
    }

    if (!body) {
      showMessage('warning', 'Notification message is required.', 'Missing Message', 'create');
      return;
    }

    if (form.target_scope === 'selected_tenant' && !form.target_tenant_id) {
      showMessage('warning', 'Please select a tenant before sending this notification.', 'Tenant Required', 'create');
      return;
    }

    if (form.target_scope === 'department' && !form.department_id) {
      showMessage('warning', 'Please select a department before sending this notification.', 'Department Required', 'create');
      return;
    }

    if (form.target_scope === 'selected_users' && !form.user_ids.length) {
      showMessage('warning', 'Please select at least one employee before sending this notification.', 'Employee Required', 'create');
      return;
    }

    const payload = {
      title,
      body,
      message: body,
      priority: form.priority || 'normal',
      notification_type: form.notification_type || 'general',
      show_popup: Boolean(form.show_popup),

      target: form.target_scope || 'tenant',
      target_scope: form.target_scope || 'tenant',
      audience: form.target_scope || 'tenant',

      target_tenant_id: form.target_tenant_id || '',
      department_id: form.department_id || '',
      department_ids: form.department_id ? [form.department_id] : [],

      team_owner_id: form.team_owner_id || '',
      team_owner_ids: form.team_owner_id ? [form.team_owner_id] : [],
      team_type: form.team_type || '',

      user_ids: Array.isArray(form.user_ids) ? form.user_ids : [],
      selected_user_ids: Array.isArray(form.user_ids) ? form.user_ids : [],
    };

    const confirmed = await showConfirm({
      title: 'Send Notification?',
      message: `Send "${title}" to the selected notification audience?`,
      confirmLabel: 'Send Notification',
    });

    if (!confirmed) {
      return;
    }

    setSaving(true);
    showMessage(
      'info',
      'Sending the notification to the selected audience...',
      'Sending Notification',
      'create',
      { loading: true },
    );

    try {
      await api('/notifications', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      resetForm();
      await loadNotifications({ silent: true });

      window.dispatchEvent(new Event('sds_hrms_notification_created'));

      showMessage('success', 'Notification sent successfully.', 'Notification Sent', 'create');
    } catch (error) {
      showMessage('error', error.message || 'Unable to create notification.', 'Notification Send Failed', 'create');
    } finally {
      setSaving(false);
    }
  };

  const handleMarkRead = async (item) => {
    const id = item._id || item.id;

    if (!id) {
      showMessage('warning', 'Invalid notification selected.', 'Notification Required', 'general');
      return;
    }

    const scope = notificationFeedbackScope(item);

    showMessage(
      'info',
      'Updating the notification read status...',
      'Updating Notification',
      scope,
      { loading: true },
    );

    try {
      await markNotificationRead(id);
      await loadNotifications({ silent: true });
      showMessage(
        'success',
        'Notification marked as read.',
        'Notification Updated',
        scope,
      );
    } catch (error) {
      showMessage(
        'error',
        error.message || 'Unable to mark notification as read.',
        'Mark Read Failed',
        scope,
      );
    }
  };

  const handleMarkAllRead = async () => {
    const confirmed = await showConfirm({
      title: 'Mark All Notifications Read?',
      message: 'Mark every currently available notification as read?',
      confirmLabel: 'Mark All Read',
    });

    if (!confirmed) {
      return;
    }

    showMessage(
      'info',
      'Updating all notification read statuses...',
      'Updating Notifications',
      'mark-all',
      { loading: true },
    );

    try {
      await markAllNotificationsRead();
      await loadNotifications({ silent: true });
      showMessage(
        'success',
        'All notifications marked as read.',
        'Notifications Updated',
        'mark-all',
      );
    } catch (error) {
      showMessage(
        'error',
        error.message || 'Unable to mark all notifications as read.',
        'Mark All Read Failed',
        'mark-all',
      );
    }
  };


  function handleNavigate(page) {
    const normalizedPage = String(page || '').trim();

    if (!normalizedPage) {
      return;
    }

    if (typeof setPage === 'function') {
      setPage(normalizedPage);
    }

    try {
      const routeMap = {
        billing: '/hrms/billing',
        subscription_expired: '/hrms/subscription-expired',
        premium_requests: '/hrms/premium-requests',
      };

      const nextPath = routeMap[normalizedPage] || '/hrms';

      window.history.pushState({}, '', nextPath);
    } catch {
      // Ignore browser history errors.
    }
  }

  const notificationTypeOptions = [
    { value: 'general', label: 'General' },
    { value: 'announcement', label: 'Announcement' },
    { value: 'policy', label: 'Policy' },
    { value: 'attendance', label: 'Attendance' },
    { value: 'leave', label: 'Leave' },
    { value: 'payroll', label: 'Payroll' },
    { value: 'urgent', label: 'Urgent' },
  ];

  const priorityOptions = [
    { value: 'low', label: 'Low' },
    { value: 'normal', label: 'Normal' },
    { value: 'high', label: 'High' },
    { value: 'urgent', label: 'Urgent' },
  ];

  return (
    <section className="page-grid notifications-page">
      <style>{`
        .notifications-page {
          --notif-ink: #101a3a;
          --notif-copy: #5d6d8d;
          --notif-blue: #4d77dd;
          --notif-cyan: #2eb2b9;
          --notif-purple: #575092;
          --notif-line: rgba(16, 26, 58, .14);
          --notif-ease: cubic-bezier(.22, 1, .36, 1);

          display: grid;
          gap: clamp(16px, 1.8vw, 24px);
          width: 100%;
          min-width: 0;
          max-width: 100%;
          padding-bottom: max(34px, env(safe-area-inset-bottom));
          color: var(--notif-ink);
          font-family: var(--yc-ui, var(--body), inherit);
        }

        .notifications-page,
        .notifications-page * {
          box-sizing: border-box;
        }

        .notifications-page > *,
        .notifications-page section,
        .notifications-page article,
        .notifications-page form,
        .notifications-page nav,
        .notifications-page label {
          min-width: 0;
          max-width: 100%;
        }

        .notifications-page h1,
        .notifications-page h2,
        .notifications-page h3,
        .notifications-page h4,
        .notifications-page p,
        .notifications-page span,
        .notifications-page strong,
        .notifications-page small,
        .notifications-page dd {
          overflow-wrap: anywhere;
        }

        .notifications-page button,
        .notifications-page input,
        .notifications-page select,
        .notifications-page textarea {
          max-width: 100%;
          font: inherit;
        }

        .notifications-page button {
          min-width: 0;
          cursor: pointer;
          touch-action: manipulation;
        }

        .notifications-page button:disabled {
          cursor: not-allowed;
          opacity: .56;
          transform: none !important;
          filter: none !important;
        }

        .notif-hero {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(190px, 310px);
          gap: clamp(20px, 3vw, 36px);
          align-items: center;
          min-height: 250px;
          padding: clamp(24px, 3vw, 40px);
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
            10px 12px 0 #b9d7ff,
            0 26px 44px rgba(70, 92, 140, .12);
        }

        .notif-hero::before,
        .notif-hero::after,
        .notif-panel::before,
        .notif-panel::after,
        .notif-form-card::before,
        .notif-form-card::after,
        .notif-record-card::before,
        .notif-record-card::after,
        .notif-section-tabs::before,
        .notif-section-tabs::after {
          content: none;
          display: none;
        }

        .notif-hero-copy {
          min-width: 0;
        }

        .notif-kicker {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          width: fit-content;
          max-width: 100%;
          padding: 9px 13px;
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

        .notif-hero h1 {
          max-width: 900px;
          margin: 15px 0 10px;
          color: var(--notif-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(42px, 5vw, 74px);
          font-weight: 760;
          line-height: .94;
          letter-spacing: -.056em;
        }

        .notif-hero p {
          max-width: 880px;
          margin: 0;
          color: var(--notif-copy);
          font-size: clamp(13px, 1vw, 16px);
          line-height: 1.68;
        }

        .notif-hero-action-stack {
          display: grid;
          gap: 9px;
          width: min(310px, 100%);
          justify-self: end;
        }

        .notif-refresh-btn,
        .notif-primary-btn,
        .notif-soft-btn,
        .notif-page-button,
        .notif-confirm-cancel,
        .notif-confirm-submit,
        .notif-confirm-close,
        .notif-inline-feedback-close {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          border-radius: 15px;
          font-weight: 900;
          line-height: 1;
          transition:
            transform 190ms var(--notif-ease),
            box-shadow 190ms ease,
            filter 190ms ease,
            opacity 190ms ease;
        }

        .notif-refresh-btn:hover:not(:disabled),
        .notif-primary-btn:hover:not(:disabled),
        .notif-soft-btn:hover:not(:disabled),
        .notif-page-button:hover:not(:disabled),
        .notif-confirm-cancel:hover:not(:disabled),
        .notif-confirm-submit:hover:not(:disabled) {
          transform: translateY(-2px);
          filter: saturate(1.04);
        }

        .notif-refresh-btn,
        .notif-primary-btn {
          min-height: 46px;
          padding: 10px 16px;
          border: 1px solid rgba(77, 119, 221, .18);
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow:
            6px 7px 0 #575092,
            0 14px 25px rgba(67, 116, 170, .16);
        }

        .notif-refresh-btn {
          width: 100%;
          min-height: 54px;
        }

        .notif-soft-btn {
          min-height: 44px;
          padding: 9px 14px;
          border: 1px solid rgba(65, 55, 161, .18);
          color: #40348d;
          background: rgba(255,255,255,.96);
          box-shadow: 3px 4px 0 rgba(52, 43, 120, .10);
        }

        .notif-stats-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 14px;
        }

        .notif-stat-card {
          min-height: 112px;
          padding: 20px;
          border: 1px solid rgba(171,181,211,.62);
          border-radius: 22px;
          background: #edf6ff;
          box-shadow:
            7px 9px 0 #b9d7ff,
            0 18px 30px rgba(34,38,110,.09);
        }

        .notif-stat-card:nth-child(2) {
          background: #eaf8f4;
          box-shadow:
            7px 9px 0 #aee6d9,
            0 18px 30px rgba(34,38,110,.09);
        }

        .notif-stat-card:nth-child(3) {
          background: #fff4d5;
          box-shadow:
            7px 9px 0 #ffe0a5,
            0 18px 30px rgba(34,38,110,.09);
        }

        .notif-stat-card span {
          display: block;
          color: #5d6785;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: .09em;
          text-transform: uppercase;
        }

        .notif-stat-card strong {
          display: block;
          margin-top: 10px;
          color: var(--notif-ink);
          font-family: Georgia, "Times New Roman", serif;
          font-size: clamp(30px, 3vw, 43px);
          line-height: 1;
        }

        .notif-section-tabs {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          width: 100%;
          padding: 9px;
          border: 1px solid rgba(171,181,211,.62);
          border-radius: 22px;
          background: rgba(255,255,255,.92);
          box-shadow:
            7px 9px 0 #c4ccff,
            0 18px 30px rgba(34,38,110,.08);
        }

        .notif-section-tab {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          min-height: 52px;
          padding: 10px 14px;
          border: 1px solid rgba(77,119,221,.18);
          border-radius: 15px;
          color: #4767b4;
          background: linear-gradient(135deg, #f0f5ff 0%, #eefcfb 100%);
          box-shadow: 3px 4px 0 rgba(87,80,146,.16);
          font-size: 11px;
          font-weight: 950;
        }

        .notif-section-tab.active {
          border-color: transparent;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow: 5px 6px 0 #575092;
        }

        .notif-section-tab small {
          color: inherit;
          opacity: .82;
          font-size: 9px;
          font-weight: 900;
        }

        .notif-panel,
        .notif-form-card {
          width: 100%;
          min-width: 0;
          overflow: hidden;
          padding: clamp(18px, 2vw, 28px);
          border: 1px solid rgba(171,181,211,.70);
          border-radius: clamp(26px, 2.2vw, 36px);
          background: #fff;
          box-shadow:
            8px 10px 0 #c4ccff,
            0 24px 42px rgba(34,38,110,.10);
        }

        .notif-section-heading {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          width: 100%;
          margin-bottom: 18px;
        }

        .notif-section-heading > div:first-child {
          flex: 1 1 auto;
          min-width: 0;
        }

        .notif-section-heading h2,
        .notif-section-heading h3 {
          margin: 0;
          color: var(--notif-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(25px, 2.3vw, 37px);
          font-weight: 760;
          line-height: 1;
          letter-spacing: -.045em;
        }

        .notif-section-heading p {
          max-width: 850px;
          margin: 8px 0 0;
          color: var(--notif-copy);
          font-size: 13px;
          line-height: 1.58;
        }

        .notif-heading-action-stack,
        .notif-filter-action-stack,
        .notif-form-action-stack,
        .notif-record-action-stack {
          display: grid;
          gap: 9px;
          min-width: 0;
        }

        .notif-heading-action-stack {
          width: min(430px, 100%);
          flex: 0 0 auto;
        }

        .notif-heading-action-row {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 12px;
          width: 100%;
          min-width: 0;
        }

        .notif-heading-count {
          display: inline-flex;
          align-items: baseline;
          gap: 7px;
          min-width: 0;
          color: var(--notif-copy);
          font-size: 10px;
          font-weight: 900;
          white-space: nowrap;
        }

        .notif-heading-count strong {
          color: var(--notif-ink);
          font-size: 16px;
        }

        .notif-filter-grid {
          display: grid;
          grid-template-columns:
            minmax(240px, 1.4fr)
            minmax(150px, .7fr)
            minmax(140px, .55fr)
            minmax(150px, auto);
          gap: 12px;
          align-items: end;
          padding: 15px;
          border: 1px solid rgba(171,181,211,.55);
          border-radius: 18px;
          background: rgba(248,250,255,.86);
        }

        .notif-filter-grid input,
        .notif-filter-grid select,
        .notif-field input,
        .notif-field select,
        .notif-field textarea,
        .notif-page-size-control select {
          width: 100%;
          min-width: 0;
          border: 1px solid rgba(151,161,197,.58);
          border-radius: 15px;
          outline: 0;
          color: var(--notif-ink);
          background: rgba(255,255,255,.96);
          font: inherit;
          font-weight: 650;
          transition:
            border-color 170ms ease,
            box-shadow 170ms ease,
            transform 170ms ease,
            background 170ms ease;
        }

        .notif-filter-grid input,
        .notif-filter-grid select,
        .notif-field input,
        .notif-field select {
          min-height: 47px;
          padding: 0 13px;
        }

        .notif-field textarea {
          min-height: 128px;
          padding: 13px;
          resize: vertical;
          line-height: 1.5;
        }

        .notif-field select[multiple] {
          min-height: 160px;
          padding: 10px;
        }

        .notif-filter-grid input:focus,
        .notif-filter-grid select:focus,
        .notif-field input:focus,
        .notif-field select:focus,
        .notif-field textarea:focus,
        .notif-page-size-control select:focus {
          border-color: rgba(77,119,221,.60);
          background: #fff;
          box-shadow:
            3px 4px 0 rgba(87,80,146,.14),
            0 0 0 4px rgba(46,178,185,.08);
        }

        .notif-filter-action-stack {
          align-self: end;
        }

        .notif-filter-buttons {
          display: flex;
          align-items: stretch;
          gap: 10px;
          width: 100%;
          min-width: 0;
        }

        .notif-filter-buttons .notif-primary-btn,
        .notif-filter-buttons .notif-soft-btn {
          flex: 1 1 0;
          min-width: 0;
          min-height: 47px;
        }

        .notif-pagination {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          margin-top: 16px;
          padding: 14px 16px;
          border: 1px solid rgba(171,181,211,.46);
          border-radius: 16px;
          background: rgba(248,250,255,.86);
        }

        .notif-pagination-copy {
          display: flex;
          align-items: baseline;
          gap: 7px;
          color: var(--notif-copy);
          font-size: 10px;
          font-weight: 900;
        }

        .notif-pagination-copy strong {
          color: var(--notif-ink);
          font-size: 16px;
        }

        .notif-pagination-controls {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          min-width: 0;
        }

        .notif-page-size-control {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: var(--notif-copy);
          font-size: 10px;
          font-weight: 900;
          white-space: nowrap;
        }

        .notif-page-size-control select {
          width: auto;
          min-width: 112px;
          height: 40px;
          padding: 0 32px 0 11px;
          color: #40348d;
          font-size: 10px;
          font-weight: 900;
          background: #f1efff;
          box-shadow: 2px 3px 0 #c9c0ff;
        }

        .notif-page-button {
          min-width: 78px;
          min-height: 40px;
          padding: 0 11px;
          border: 1px solid rgba(65,55,161,.18);
          color: #40348d;
          background: #fff;
          box-shadow: 2px 3px 0 rgba(52,43,120,.10);
          font-size: 10px;
        }

        .notif-page-indicator {
          min-width: 82px;
          color: var(--notif-copy);
          font-size: 10px;
          font-weight: 900;
          text-align: center;
          white-space: nowrap;
        }

        .notif-list {
          display: grid;
          gap: 18px;
          margin-top: 18px;
        }

        .notif-record-card {
          overflow: hidden;
          border: 1px solid rgba(171,181,211,.66);
          border-radius: 28px;
          background: #fff;
          box-shadow:
            8px 10px 0 #c4ccff,
            0 22px 40px rgba(34,38,110,.09);
        }

        .notif-record-card.unread {
          border-color: rgba(77,119,221,.30);
        }

        .notif-record-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          min-width: 0;
          padding: 18px 22px;
          border-bottom: 1px solid rgba(171,181,211,.34);
          background: linear-gradient(135deg, #edf6ff 0%, #f6f3ff 100%);
        }

        .notif-record-identity {
          display: flex;
          align-items: center;
          gap: 14px;
          min-width: 0;
        }

        .notif-record-avatar {
          display: grid;
          place-items: center;
          width: 58px;
          height: 58px;
          flex: 0 0 58px;
          border: 2px solid #fff;
          border-radius: 50%;
          color: #40348d;
          background: #f1efff;
          box-shadow:
            4px 5px 0 #c9c0ff,
            0 10px 22px rgba(34,38,110,.09);
        }

        .notif-record-title {
          min-width: 0;
        }

        .notif-record-title h3 {
          margin: 0;
          color: var(--notif-ink);
          font-size: 16px;
          font-weight: 950;
          line-height: 1.2;
        }

        .notif-record-title p,
        .notif-record-title small {
          display: block;
          margin: 4px 0 0;
          color: var(--notif-copy);
          font-size: 10px;
          font-weight: 750;
          line-height: 1.4;
        }

        .notif-record-status {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          flex-wrap: wrap;
        }

        .notif-pill {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 34px;
          width: fit-content;
          max-width: 100%;
          padding: 7px 11px;
          border-radius: 999px;
          font-size: 9px;
          font-style: normal;
          font-weight: 950;
          line-height: 1;
          text-transform: capitalize;
          white-space: nowrap;
        }

        .notif-pill-green {
          color: #047857;
          background: #eaf8f4;
          box-shadow: 3px 4px 0 #aee6d9;
        }

        .notif-pill-blue {
          color: #3657b5;
          background: #edf6ff;
          box-shadow: 3px 4px 0 #b9d7ff;
        }

        .notif-pill-red {
          color: #a2344d;
          background: #fff0f2;
          box-shadow: 3px 4px 0 #f2c2cc;
        }

        .notif-pill-gray {
          color: #5f6983;
          background: #edf0f6;
          box-shadow: 3px 4px 0 #d8dde9;
        }

        .notif-record-body {
          display: grid;
          grid-template-columns: 1.1fr .92fr .92fr;
          gap: 14px;
          padding: 20px 22px;
        }

        .notif-record-panel {
          min-width: 0;
          min-height: 190px;
          padding: 16px;
          border: 1px solid rgba(171,181,211,.58);
          border-radius: 20px;
          background: #f8fbff;
        }

        .notif-record-panel:nth-child(2) {
          background: #f8f6ff;
        }

        .notif-record-panel:nth-child(3) {
          background: #f3fbf8;
        }

        .notif-record-panel-label {
          display: block;
          margin-bottom: 14px;
          color: #5d6785;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: .075em;
          text-transform: uppercase;
        }

        .notif-record-message-panel p {
          margin: 0;
          color: #263553;
          font-size: 12px;
          font-weight: 700;
          line-height: 1.65;
          white-space: pre-wrap;
        }

        .notif-record-details {
          display: grid;
          gap: 14px;
          margin: 0;
        }

        .notif-record-details > div {
          min-width: 0;
        }

        .notif-record-details dt {
          margin: 0 0 5px;
          color: #667391;
          font-size: 8px;
          font-weight: 950;
          letter-spacing: .06em;
          text-transform: uppercase;
        }

        .notif-record-details dd {
          margin: 0;
          color: var(--notif-ink);
          font-size: 11px;
          font-weight: 900;
          line-height: 1.4;
        }

        .notif-record-footer {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 18px;
          min-width: 0;
          padding: 16px 22px 18px;
          border-top: 1px solid rgba(171,181,211,.34);
          background: #fbfcff;
        }

        .notif-record-control-copy {
          min-width: 0;
        }

        .notif-record-control-copy span {
          display: block;
          margin-bottom: 5px;
          color: #667391;
          font-size: 8px;
          font-weight: 950;
          letter-spacing: .075em;
          text-transform: uppercase;
        }

        .notif-record-control-copy strong {
          color: var(--notif-ink);
          font-size: 12px;
          font-weight: 900;
        }

        .notif-record-action-stack {
          width: fit-content;
          max-width: min(760px, 100%);
          justify-self: end;
          justify-items: stretch;
        }

        .notif-card-actions,
        .notif-form-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 10px;
          flex-wrap: wrap;
        }

        .notif-card-actions .notif-primary-btn,
        .notif-card-actions .notif-soft-btn {
          min-height: 42px;
          padding: 9px 13px;
          font-size: 10px;
        }

        .notif-record-action-feedback {
          width: 100%;
          max-width: 100%;
        }

        .notif-form-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }

        .notif-field {
          display: grid;
          gap: 8px;
          min-width: 0;
          color: #303b5b;
          font-size: 11px;
          font-weight: 900;
        }

        .notif-field-full {
          grid-column: 1 / -1;
        }

        .notif-field > span {
          color: inherit;
        }

        .notif-field b {
          margin-left: 3px;
          color: #b62f55;
        }

        .notif-helper-text {
          color: var(--notif-copy);
          font-size: 9px;
          line-height: 1.45;
        }

        .notif-checkbox {
          grid-column: 1 / -1;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 13px;
          border: 1px solid rgba(171,181,211,.50);
          border-radius: 15px;
          color: #334164;
          background: #f8fbff;
          font-size: 11px;
          font-weight: 850;
        }

        .notif-checkbox input {
          width: 18px;
          min-width: 18px;
          height: 18px;
          accent-color: #4d77dd;
        }

        .notif-form-action-stack {
          margin-top: 18px;
          width: 100%;
        }

        .notif-form-actions {
          width: 100%;
        }

        .notif-form-actions .notif-primary-btn,
        .notif-form-actions .notif-soft-btn {
          min-width: 170px;
        }

        .notif-note,
        .notif-empty {
          padding: 22px;
          border: 1px solid rgba(171,181,211,.54);
          border-radius: 18px;
          color: var(--notif-copy);
          background: #f8fbff;
          font-size: 11px;
          font-weight: 850;
          line-height: 1.55;
          text-align: center;
        }

        .notif-inline-feedback {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          gap: 9px;
          align-items: start;
          width: 100%;
          min-width: 0;
          padding: 10px 11px;
          border: 1px solid rgba(77,119,221,.18);
          border-radius: 12px;
          color: #4767b4;
          background: linear-gradient(135deg, #f0f5ff 0%, #eefcfb 100%);
          box-shadow: 3px 4px 0 rgba(87,80,146,.18);
          font-size: 10px;
          line-height: 1.45;
        }

        .notif-inline-feedback.success {
          border-color: rgba(4,120,87,.18);
          color: #047857;
          background: #eaf8f4;
          box-shadow: 3px 4px 0 #aee6d9;
        }

        .notif-inline-feedback.warning {
          border-color: rgba(154,104,23,.18);
          color: #9a6817;
          background: #fff4d5;
          box-shadow: 3px 4px 0 #ffe0a5;
        }

        .notif-inline-feedback.error {
          border-color: rgba(162,52,77,.18);
          color: #a2344d;
          background: #fff0f2;
          box-shadow: 3px 4px 0 #f2c2cc;
        }

        .notif-inline-feedback-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          flex: 0 0 22px;
        }

        .notif-inline-feedback-copy {
          min-width: 0;
        }

        .notif-inline-feedback-copy strong,
        .notif-inline-feedback-copy > span {
          display: block;
        }

        .notif-inline-feedback-copy strong {
          margin-bottom: 2px;
          font-size: 10px;
          font-weight: 950;
        }

        .notif-inline-feedback-copy > span {
          font-weight: 750;
        }

        .notif-inline-feedback-close {
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

        .notif-inline-feedback-close:hover {
          transform: none !important;
          filter: none !important;
          opacity: 1;
          background: rgba(255,255,255,.92);
        }

        .notif-inline-spin {
          animation: notifInlineSpin .8s linear infinite;
        }

        @keyframes notifInlineSpin {
          to { transform: rotate(360deg); }
        }

        .notif-confirm-backdrop {
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
          background: rgba(15,23,42,.58);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          overscroll-behavior: none;
        }

        .notif-confirm-popup {
          width: min(800px, calc(100vw - 36px));
          max-height: min(88dvh, 760px);
          overflow-y: auto;
          border: 1px solid rgba(171,181,211,.74);
          border-radius: 28px;
          background: #fff;
          box-shadow:
            0 32px 86px rgba(22,29,73,.32),
            10px 12px 0 rgba(185,215,255,.46);
        }

        .notif-confirm-header {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          gap: 13px;
          align-items: center;
          padding: 20px;
          border-bottom: 1px solid rgba(171,181,211,.42);
          background: linear-gradient(135deg, #edf6ff 0%, #f6f3ff 100%);
        }

        .notif-confirm-icon {
          display: grid;
          place-items: center;
          width: 46px;
          height: 46px;
          border-radius: 14px;
          color: #40348d;
          background: #f1efff;
          box-shadow: 3px 4px 0 #c9c0ff;
        }

        .notif-confirm-heading {
          min-width: 0;
        }

        .notif-confirm-heading > span {
          display: block;
          color: #667391;
          font-size: 8px;
          font-weight: 950;
          letter-spacing: .09em;
          text-transform: uppercase;
        }

        .notif-confirm-heading h3 {
          margin: 4px 0 0;
          color: var(--notif-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(23px, 2.2vw, 31px);
          line-height: 1;
        }

        .notif-confirm-close {
          width: 42px;
          min-width: 42px;
          height: 42px;
          padding: 0;
          border: 1px solid rgba(65,55,161,.18);
          color: #40348d;
          background: #fff;
          box-shadow: 3px 4px 0 rgba(52,43,120,.10);
        }

        .notif-confirm-body {
          padding: 28px 30px;
          text-align: center;
        }

        .notif-confirm-body p {
          margin: 0;
          color: #4f5f7e;
          font-size: 14px;
          font-weight: 850;
          line-height: 1.6;
        }

        .notif-confirm-footer {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
          padding: 18px 30px 24px;
          border-top: 1px solid rgba(171,181,211,.34);
          background: #fbfcff;
        }

        .notif-confirm-cancel,
        .notif-confirm-submit {
          min-height: 54px;
          padding: 10px 16px;
        }

        .notif-confirm-cancel {
          border: 1px solid rgba(65,55,161,.18);
          color: #40348d;
          background: #fff;
          box-shadow: 4px 5px 0 rgba(52,43,120,.10);
        }

        .notif-confirm-submit {
          border: 1px solid rgba(77,119,221,.18);
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow:
            6px 7px 0 #575092,
            0 14px 25px rgba(67,116,170,.16);
        }

        @media (max-width: 1180px) {
          .notif-record-body {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .notif-record-message-panel {
            grid-column: 1 / -1;
            min-height: 150px;
          }
        }

        @media (max-width: 900px) {
          .notif-hero {
            grid-template-columns: 1fr;
          }

          .notif-hero-action-stack {
            width: 100%;
            justify-self: stretch;
          }

          .notif-filter-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .notif-filter-action-stack {
            grid-column: 1 / -1;
          }

          .notif-pagination {
            align-items: stretch;
            flex-direction: column;
          }

          .notif-pagination-controls {
            justify-content: flex-start;
            flex-wrap: wrap;
          }
        }

        @media (max-width: 720px) {
          .notifications-page {
            gap: 15px;
          }

          .notif-hero {
            min-height: 0;
            padding: 20px;
            border-radius: 24px;
            box-shadow:
              7px 8px 0 #b9d7ff,
              0 18px 30px rgba(34,38,110,.10);
          }

          .notif-hero h1 {
            font-size: clamp(31px, 9.5vw, 43px);
          }

          .notif-stats-grid {
            grid-template-columns: 1fr;
          }

          .notif-section-tabs {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            padding: 7px;
            border-radius: 17px;
          }

          .notif-section-tab {
            min-height: 46px;
            padding: 9px 8px;
            border-radius: 13px;
            font-size: 9px;
          }

          .notif-section-tab svg {
            width: 16px;
            height: 16px;
          }

          .notif-section-tab small {
            display: none;
          }

          .notif-panel,
          .notif-form-card {
            padding: 16px;
            border-radius: 22px;
            box-shadow:
              6px 7px 0 #d1dcfa,
              0 16px 28px rgba(34,38,110,.08);
          }

          .notif-section-heading {
            flex-direction: column;
          }

          .notif-heading-action-stack {
            width: 100%;
          }

          .notif-heading-action-row {
            justify-content: space-between;
          }

          .notif-filter-grid,
          .notif-form-grid,
          .notif-record-body {
            grid-template-columns: 1fr;
          }

          .notif-filter-action-stack,
          .notif-record-message-panel {
            grid-column: auto;
          }

          .notif-record-panel,
          .notif-record-message-panel {
            min-height: auto;
          }

          .notif-record-header,
          .notif-record-footer {
            align-items: stretch;
            flex-direction: column;
          }

          .notif-record-status {
            justify-content: flex-start;
          }

          .notif-record-action-stack {
            width: 100%;
            max-width: none;
          }

          .notif-card-actions,
          .notif-form-actions {
            width: 100%;
            justify-content: stretch;
          }

          .notif-card-actions button,
          .notif-form-actions button {
            flex: 1 1 0;
          }

          .notif-form-actions .notif-primary-btn,
          .notif-form-actions .notif-soft-btn {
            min-width: 0;
          }

          .notif-pagination-controls {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            width: 100%;
          }

          .notif-page-size-control {
            grid-column: 1 / -1;
            width: 100%;
          }

          .notif-page-size-control select {
            flex: 1 1 auto;
            width: 100%;
          }

          .notif-page-indicator {
            grid-column: 1 / -1;
            grid-row: 2;
            width: 100%;
          }

          .notif-page-button {
            width: 100%;
          }

          .notif-confirm-backdrop {
            align-items: end;
            padding: 0;
          }

          .notif-confirm-popup {
            width: 100%;
            max-width: 100%;
            max-height: calc(100dvh - max(8px, env(safe-area-inset-top)));
            margin: 0;
            border-radius: 24px 24px 0 0;
          }

          .notif-confirm-footer {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 460px) {
          .notif-record-header {
            padding: 15px;
          }

          .notif-record-body {
            padding: 15px;
          }

          .notif-record-footer {
            padding: 14px 15px 16px;
          }

          .notif-record-identity {
            align-items: flex-start;
          }

          .notif-record-avatar {
            width: 48px;
            height: 48px;
            flex-basis: 48px;
          }

          .notif-card-actions {
            display: grid;
            grid-template-columns: 1fr;
          }

          .notif-card-actions button {
            width: 100%;
          }

          .notif-confirm-header {
            padding: 16px;
          }

          .notif-confirm-body {
            padding: 24px 18px;
          }

          .notif-confirm-footer {
            padding: 16px 18px max(18px, env(safe-area-inset-bottom));
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .notifications-page *,
          .notifications-page *::before,
          .notifications-page *::after {
            scroll-behavior: auto !important;
            animation-duration: .01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: .01ms !important;
          }
        }
      `}</style>

      <div className="notif-hero">
        <div className="notif-hero-copy">
          <span className="notif-kicker">
            <Megaphone size={14} />
            Notification Center
          </span>

          <h1>Tenant Notifications & Announcements</h1>

          <p>
            HR, Admin, Super Admin, Managing Director, Manager and Team Leader rank users
            can send notifications to everyone in their own tenant only. Notifications
            are shown in the bell, notification center and dashboard popup.
          </p>
        </div>

        <div className="notif-hero-action-stack">
          <button
            type="button"
            className="notif-refresh-btn"
            onClick={() => loadNotifications({ feedbackScope: 'refresh', silent: true })}
            disabled={loading || Boolean(inlineFeedback.refresh?.loading)}
          >
            <RefreshCw size={17} className={inlineFeedback.refresh?.loading ? 'notif-inline-spin' : ''} />
            {inlineFeedback.refresh?.loading ? 'Refreshing...' : 'Refresh Notifications'}
          </button>

          <NotificationInlineMessage
            feedback={inlineFeedback.refresh}
            onClose={() => clearInlineFeedback('refresh')}
          />
        </div>
      </div>

      <div className="notif-stats-grid">
        <div className="notif-stat-card">
          <span>Total Notifications</span>
          <strong>{stats.total}</strong>
        </div>

        <div className="notif-stat-card">
          <span>Unread</span>
          <strong>{unreadCount || stats.unread}</strong>
        </div>

        <div className="notif-stat-card">
          <span>Popup Enabled</span>
          <strong>{stats.popup}</strong>
        </div>
      </div>

      <nav className="notif-section-tabs" aria-label="Notification sections">
        <button
          type="button"
          className={`notif-section-tab ${activeSection === 'notifications' ? 'active' : ''}`}
          onClick={() => setActiveSection('notifications')}
          aria-pressed={activeSection === 'notifications'}
        >
          <Inbox size={18} />
          <span>Notifications</span>
          <small>{filteredItems.length}</small>
        </button>

        <button
          type="button"
          className={`notif-section-tab ${activeSection === 'create' ? 'active' : ''}`}
          onClick={() => setActiveSection('create')}
          aria-pressed={activeSection === 'create'}
        >
          <Send size={18} />
          <span>Create Notification</span>
          <small>{canCreate ? 'Compose' : 'View Access'}</small>
        </button>
      </nav>

      <NotificationInlineMessage
        feedback={inlineFeedback.general}
        onClose={() => clearInlineFeedback('general')}
      />

      {activeSection === 'notifications' ? (
        <div className="notif-panel">
          <div className="notif-section-heading">
            <div>
              <h2>Notifications</h2>
              <p>
                View received tenant notifications, filter unread messages and mark them as read.
              </p>
            </div>

            <div className="notif-heading-action-stack">
              <div className="notif-heading-action-row">
                <span className="notif-heading-count">
                  <strong>{filteredItems.length.toLocaleString('en-IN')}</strong>
                  <span>notifications</span>
                </span>

                <button
                  type="button"
                  className="notif-soft-btn"
                  onClick={handleMarkAllRead}
                  disabled={Boolean(inlineFeedback['mark-all']?.loading)}
                >
                  <CheckCircle2 size={16} />
                  Mark All Read
                </button>
              </div>

              <NotificationInlineMessage
                feedback={inlineFeedback['mark-all']}
                onClose={() => clearInlineFeedback('mark-all')}
              />
            </div>
          </div>

          <div className="notif-filter-grid">
            <input
              name="q"
              value={filters.q}
              onChange={handleFilterChange}
              placeholder="Search notification title, message, type..."
              aria-label="Search notifications"
            />

            <select
              name="unread"
              value={filters.unread}
              onChange={handleFilterChange}
              aria-label="Notification read status"
            >
              <option value="">All</option>
              <option value="true">Unread Only</option>
            </select>

            <select
              name="limit"
              value={filters.limit}
              onChange={handleFilterChange}
              aria-label="Notifications to load"
            >
              <option value="50">Load 50</option>
              <option value="100">Load 100</option>
              <option value="200">Load 200</option>
            </select>

            <div className="notif-filter-action-stack">
              <div className="notif-filter-buttons">
                <button
                  type="button"
                  className="notif-soft-btn"
                  onClick={handleResetFilters}
                  disabled={loading || Boolean(inlineFeedback.filter?.loading)}
                >
                  Reset
                </button>

                <button
                  type="button"
                  className="notif-primary-btn"
                  onClick={handleApplyFilters}
                  disabled={loading || Boolean(inlineFeedback.filter?.loading)}
                >
                  {inlineFeedback.filter?.loading ? (
                    <Loader2 size={16} className="notif-inline-spin" />
                  ) : (
                    <Inbox size={16} />
                  )}
                  Apply Filters
                </button>
              </div>

              <NotificationInlineMessage
                feedback={inlineFeedback.filter}
                onClose={() => clearInlineFeedback('filter')}
              />
            </div>
          </div>

          {loading ? (
            <div className="notif-empty">Loading notifications...</div>
          ) : filteredItems.length ? (
            <div className="notif-list">
              {filteredItems.map((item) => {
                const scope = notificationFeedbackScope(item);

                return (
                  <NotificationCard
                    key={item._id || item.id || `${item.title}-${item.created_at}`}
                    item={item}
                    onMarkRead={handleMarkRead}
                    onNavigate={handleNavigate}
                    feedback={inlineFeedback[scope]}
                    onFeedbackClose={() => clearInlineFeedback(scope)}
                  />
                );
              })}
            </div>
          ) : (
            <div className="notif-empty">No notifications found.</div>
          )}
        </div>
      ) : null}

      {activeSection === 'create' ? (
        <div className="notif-form-card">
          <div className="notif-section-heading">
            <div>
              <h3>Create Notification</h3>
              <p>
                Send notifications to all employees, one department, one team or selected employees
                based on your role access.
              </p>
            </div>
          </div>

          {canCreate ? (
            <form onSubmit={handleCreateNotification} noValidate>
              <div className="notif-form-grid">
                <TextInput
                  label="Title"
                  name="title"
                  value={form.title}
                  onChange={handleFormChange}
                  required
                  placeholder="Notification title"
                />

                <SelectInput
                  label="Priority"
                  name="priority"
                  value={form.priority}
                  onChange={handleFormChange}
                  options={priorityOptions}
                />

                <SelectInput
                  label="Notification Type"
                  name="notification_type"
                  value={form.notification_type}
                  onChange={handleFormChange}
                  options={notificationTypeOptions}
                />

                <SelectInput
                  label="Send To"
                  name="target_scope"
                  value={form.target_scope}
                  onChange={handleFormChange}
                  options={targetOptions}
                />

                {form.target_scope === 'selected_tenant' ? (
                  <SelectInput
                    label="Select Tenant"
                    name="target_tenant_id"
                    value={form.target_tenant_id}
                    onChange={handleFormChange}
                    options={[
                      { value: '', label: 'Select tenant' },
                      ...tenantOptions,
                    ]}
                    required
                  />
                ) : null}

                {form.target_scope === 'department' ? (
                  <SelectInput
                    label="Select Department"
                    name="department_id"
                    value={form.department_id}
                    onChange={handleFormChange}
                    options={[
                      { value: '', label: 'Select department' },
                      ...departmentOptions,
                    ]}
                    required
                  />
                ) : null}

                {form.target_scope === 'team' ? (
                  <>
                    <SelectInput
                      label="Team Type"
                      name="team_type"
                      value={form.team_type}
                      onChange={handleFormChange}
                      options={[
                        { value: '', label: 'Auto / My Mapped Team' },
                        { value: 'team_leader', label: 'Team Leader Team' },
                        { value: 'reporting_officer', label: 'Reporting Officer Team' },
                      ]}
                    />

                    <SelectInput
                      label="Select Team Owner"
                      name="team_owner_id"
                      value={form.team_owner_id}
                      onChange={handleFormChange}
                      options={[
                        { value: '', label: 'My mapped team / auto' },
                        ...teamOptions,
                      ]}
                    />
                  </>
                ) : null}

                {form.target_scope === 'selected_users' ? (
                  <MultiSelectInput
                    label="Select Employees"
                    name="user_ids"
                    value={form.user_ids}
                    onChange={handleFormChange}
                    options={userOptions}
                    required
                    helper="Hold Ctrl and click to select multiple employees."
                  />
                ) : null}

                <TextAreaInput
                  label="Message"
                  name="body"
                  value={form.body}
                  onChange={handleFormChange}
                  required
                  placeholder="Write notification message"
                />

                <label className="notif-checkbox">
                  <input
                    type="checkbox"
                    name="show_popup"
                    checked={Boolean(form.show_popup)}
                    onChange={handleFormChange}
                  />
                  <span>Show as dashboard popup animation</span>
                </label>
              </div>

              <div className="notif-form-action-stack">
                <div className="notif-form-actions">
                  <button
                    type="button"
                    className="notif-soft-btn"
                    onClick={handleResetForm}
                    disabled={saving}
                  >
                    Reset
                  </button>

                  <button
                    type="submit"
                    className="notif-primary-btn"
                    disabled={saving}
                  >
                    {saving ? (
                      <Loader2 size={16} className="notif-inline-spin" />
                    ) : (
                      <Send size={16} />
                    )}
                    {saving ? 'Sending...' : 'Send Notification'}
                  </button>
                </div>

                <NotificationInlineMessage
                  feedback={inlineFeedback.create}
                  onClose={() => clearInlineFeedback('create')}
                />
              </div>
            </form>
          ) : (
            <>
              <div className="notif-note">
                You can view notifications, but your role or designation cannot create new notifications.
              </div>

              <NotificationInlineMessage
                feedback={inlineFeedback.create}
                onClose={() => clearInlineFeedback('create')}
              />
            </>
          )}
        </div>
      ) : null}

      <NotificationConfirmPopup
        popup={confirmPopup}
        onConfirm={() => resolveConfirm(true)}
        onCancel={() => resolveConfirm(false)}
      />
    </section>
  );
}
