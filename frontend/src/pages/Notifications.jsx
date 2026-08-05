import { useEffect, useMemo, useState } from 'react';
import {
  api,
  currentUser,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../api/client';
import { canCreateNotifications } from '../data/modules';
import { useCustomAlert } from '../components/CustomAlertProvider.jsx';

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

function NotificationCard({ item, onMarkRead, onNavigate }) {
  const isUnread = item.read !== true && item.status !== 'read';
  const action = getNotificationAction(item);
  const platformNotification = isPlatformNotification(item);

  return (
    <article className={`notif-card ${isUnread ? 'unread' : ''}`}>
      <div className="notif-card-top">
        <div>
          <h3>{displayValue(item.title, 'Notification')}</h3>
          <p>{displayValue(item.body || item.message, '')}</p>
        </div>

        <div className="notif-card-actions">
          <span className={`notif-pill ${isUnread ? 'notif-pill-green' : 'notif-pill-gray'}`}>
            {notificationStatusLabel(item)}
          </span>
          {platformNotification ? (
            <span className="notif-pill notif-pill-blue">
              Platform
            </span>
          ) : null}
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
            >
              Mark Read
            </button>
          ) : null}
        </div>
      </div>

      <div className="notif-meta-grid">
        <span>
          <b>Tenant:</b> {notificationTargetLabel(item)}
        </span>
        <span>
          <b>Type:</b> {displayValue(item.notification_type, 'general')}
        </span>
        <span>
          <b>Priority:</b>{' '}
          <em className={`notif-pill ${priorityClass(item.priority)}`}>
            {displayValue(item.priority, 'normal')}
          </em>
        </span>
        <span>
          <b>Popup:</b> {item.show_popup === false ? 'No' : 'Yes'}
        </span>
        <span>
          <b>Created:</b> {formatDate(item.created_at)}
        </span>
        <span>
          <b>From:</b> {displayValue(item.created_by_name || item.sender_name, 'System')}
        </span>
      </div>
    </article>
  );
}

// SaaS trial notifications use 15-day full-access trial wording.
export default function Notifications({ setPage } = {}) {
  const alerts = useCustomAlert();
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

  const [form, setForm] = useState(EMPTY_FORM);


  const filteredItems = useMemo(() => {
    const q = String(filters.q || '').trim().toLowerCase();

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
  }, [items, filters.q]);

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

  const showMessage = (type, text, title = '') => {
    const cleanText = text || 'Notification action completed.';

    if (type === 'success') {
      alerts.success(cleanText, title || 'Notification Success');
      return;
    }

    if (type === 'warning') {
      alerts.warning(cleanText, title || 'Notification Notice');
      return;
    }

    if (type === 'info') {
      alerts.info(cleanText, title || 'Notification Notice');
      return;
    }

    alerts.error(cleanText, title || 'Notification Error');
  };

  const loadNotifications = async () => {
    setLoading(true);

    try {
      const params = {
        limit: filters.limit || 100,
      };

      if (filters.unread === 'true') {
        params.unread = true;
      }

      const data = await getNotifications(params);

      setItems(data.items || []);
      setUnreadCount(Number(data.unread_count || 0));
    } catch (error) {
      showMessage('error', error.message || 'Unable to load notifications.', 'Notifications Load Failed');
    } finally {
      setLoading(false);
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
      showMessage('error', error.message || 'Unable to load notification target options.', 'Target Options Load Failed');
    }
  };


  useEffect(() => {
    loadNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.unread, filters.limit]);


  useEffect(() => {
    loadNotificationOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCreate]);

  const handleFilterChange = (event) => {
    const { name, value } = event.target;

    setFilters((previous) => ({
      ...previous,
      [name]: value,
    }));
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

  const handleCreateNotification = async (event) => {
    event.preventDefault();

    if (!canCreate) {
      showMessage('error', 'You do not have permission to create notifications.', 'Permission Denied');
      return;
    }

    const title = String(form.title || '').trim();
    const body = String(form.body || '').trim();

    if (!title) {
      showMessage('warning', 'Notification title is required.', 'Missing Title');
      return;
    }

    if (!body) {
      showMessage('warning', 'Notification message is required.', 'Missing Message');
      return;
    }

    if (form.target_scope === 'selected_tenant' && !form.target_tenant_id) {
      showMessage('warning', 'Please select a tenant before sending this notification.', 'Tenant Required');
      return;
    }

    if (form.target_scope === 'department' && !form.department_id) {
      showMessage('warning', 'Please select a department before sending this notification.', 'Department Required');
      return;
    }

    if (form.target_scope === 'selected_users' && !form.user_ids.length) {
      showMessage('warning', 'Please select at least one employee before sending this notification.', 'Employee Required');
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

    setSaving(true);

    try {
      await api('/notifications', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      resetForm();
      await loadNotifications();

      window.dispatchEvent(new Event('sds_hrms_notification_created'));

      showMessage('success', 'Notification sent successfully.', 'Notification Sent');
    } catch (error) {
      showMessage('error', error.message || 'Unable to create notification.', 'Notification Send Failed');
    } finally {
      setSaving(false);
    }
  };

  const handleMarkRead = async (item) => {
    const id = item._id || item.id;

    if (!id) {
      showMessage('warning', 'Invalid notification selected.', 'Notification Required');
      return;
    }

    try {
      await markNotificationRead(id);
      await loadNotifications();
      showMessage('success', 'Notification marked as read.', 'Notification Updated');
    } catch (error) {
      showMessage('error', error.message || 'Unable to mark notification as read.', 'Mark Read Failed');
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await markAllNotificationsRead();
      await loadNotifications();
      showMessage('success', 'All notifications marked as read.', 'Notifications Updated');
    } catch (error) {
      showMessage('error', error.message || 'Unable to mark all notifications as read.', 'Mark All Read Failed');
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
    <section className="notifications-page">
      <style>{`
        .notifications-page {
          --notif-ink: #101a3a;
          --notif-ink-soft: #596483;
          --notif-violet: #6254da;
          --notif-violet-deep: #342b78;
          --notif-blue: #3766db;
          --notif-teal: #18aaa8;
          --notif-sky: #edf8ff;
          --notif-lilac: #f1efff;
          --notif-paper: #fbfcff;
          --notif-line: rgba(65, 55, 161, 0.15);
          --notif-flat-blue: #b9d7ff;
          --notif-flat-violet: #c9c0ff;

          display: flex;
          flex-direction: column;
          gap: 20px;
          width: 100%;
          color: var(--notif-ink);
          font-family: var(--yc-ui, var(--body), inherit);
        }

        .notif-hero {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          padding: clamp(22px, 2.5vw, 34px);
          border: 1px solid rgba(171, 181, 211, 0.72);
          border-radius: clamp(26px, 2.4vw, 38px);
          color: var(--notif-ink);
          background:
            radial-gradient(circle at 8% 10%, rgba(121, 219, 238, 0.34), transparent 31%),
            radial-gradient(circle at 92% 10%, rgba(191, 190, 249, 0.32), transparent 34%),
            linear-gradient(135deg, #f1fbff 0%, #fffdf8 48%, #f8f2ff 100%);
          box-shadow:
            12px 14px 0 var(--notif-flat-blue),
            0 28px 48px rgba(34, 38, 110, 0.13);
        }

        .notif-hero::before {
          content: "";
          position: absolute;
          inset: 0;
          z-index: -2;
          pointer-events: none;
          opacity: 0.4;
          background-image:
            linear-gradient(rgba(65, 55, 161, 0.035) 1px, transparent 1px),
            linear-gradient(90deg, rgba(65, 55, 161, 0.035) 1px, transparent 1px);
          background-size: 42px 42px;
        }

        .notif-hero::after {
          content: "";
          position: absolute;
          z-index: -1;
          width: clamp(150px, 18vw, 270px);
          aspect-ratio: 1;
          right: clamp(-95px, -6vw, -45px);
          top: clamp(-110px, -7vw, -55px);
          border: 1px solid rgba(65, 55, 161, 0.12);
          border-radius: 34% 66% 58% 42% / 44% 38% 62% 56%;
          background: linear-gradient(145deg, rgba(105, 217, 208, 0.7), rgba(121, 189, 242, 0.7));
          transform: rotate(18deg);
        }

        .notif-hero-content {
          position: relative;
          z-index: 1;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 24px;
        }

        .notif-kicker {
          display: inline-flex;
          align-items: center;
          width: max-content;
          max-width: 100%;
          padding: 9px 13px;
          border-radius: 999px;
          color: #ffffff;
          background: var(--notif-violet-deep);
          font-size: clamp(8px, 0.7vw, 10px);
          font-weight: 950;
          line-height: 1;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }

        .notif-hero h1 {
          max-width: 820px;
          margin: 15px 0 9px;
          color: var(--notif-ink);
          font-family: var(--yc-display, var(--heading), inherit);
          font-size: clamp(32px, 4.1vw, 62px);
          font-weight: 760;
          line-height: 0.94;
          letter-spacing: -0.052em;
        }

        .notif-hero p {
          max-width: 850px;
          margin: 0;
          color: var(--notif-ink-soft);
          font-size: clamp(13px, 1vw, 16px);
          line-height: 1.68;
        }

        .notif-refresh-btn,
        .notif-primary-btn,
        .notif-soft-btn {
          appearance: none;
          border: 0;
          cursor: pointer;
          font: inherit;
          font-weight: 900;
          line-height: 1;
          transition:
            transform 180ms ease,
            box-shadow 180ms ease,
            border-color 180ms ease,
            filter 180ms ease;
        }

        .notif-refresh-btn:hover,
        .notif-primary-btn:hover,
        .notif-soft-btn:hover {
          transform: translateY(-2px);
          filter: saturate(1.04);
        }

        .notif-refresh-btn:focus-visible,
        .notif-primary-btn:focus-visible,
        .notif-soft-btn:focus-visible,
        .notif-field input:focus-visible,
        .notif-field select:focus-visible,
        .notif-field textarea:focus-visible,
        .notif-filter-grid input:focus-visible,
        .notif-filter-grid select:focus-visible {
          outline: 3px solid rgba(98, 84, 218, 0.2);
          outline-offset: 2px;
        }

        .notif-refresh-btn {
          flex: 0 0 auto;
          min-height: 44px;
          padding: 12px 16px;
          border: 1px solid rgba(65, 55, 161, 0.18);
          border-radius: 15px;
          color: var(--notif-violet-deep);
          background: rgba(255, 255, 255, 0.82);
          box-shadow: 5px 6px 0 rgba(52, 43, 120, 0.18);
        }

        .notif-primary-btn {
          min-height: 42px;
          padding: 12px 16px;
          border: 1px solid rgba(52, 43, 120, 0.16);
          border-radius: 14px;
          color: #ffffff;
          background: linear-gradient(145deg, #4f72df, #2bb9b5);
          box-shadow:
            5px 6px 0 rgba(52, 43, 120, 0.8),
            0 12px 22px rgba(55, 102, 219, 0.16);
        }

        .notif-primary-btn:disabled {
          cursor: not-allowed;
          opacity: 0.62;
          transform: none;
          filter: none;
        }

        .notif-soft-btn {
          min-height: 40px;
          padding: 11px 14px;
          border: 1px solid rgba(98, 84, 218, 0.18);
          border-radius: 13px;
          color: var(--notif-violet-deep);
          background: #f1efff;
          box-shadow: 4px 5px 0 rgba(98, 84, 218, 0.14);
        }

        .notif-stats-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 16px;
        }

        .notif-stat-card {
          position: relative;
          overflow: hidden;
          min-width: 0;
          padding: 19px 20px;
          border: 1px solid rgba(171, 181, 211, 0.7);
          border-radius: 22px;
          background: #f8fbff;
          box-shadow:
            7px 9px 0 var(--notif-flat-blue),
            0 18px 30px rgba(15, 20, 75, 0.09);
        }

        .notif-stat-card:nth-child(2) {
          background: #f1efff;
          box-shadow:
            7px 9px 0 var(--notif-flat-violet),
            0 18px 30px rgba(15, 20, 75, 0.09);
        }

        .notif-stat-card:nth-child(3) {
          background: #eaf8f4;
          box-shadow:
            7px 9px 0 #aee6d9,
            0 18px 30px rgba(15, 20, 75, 0.09);
        }

        .notif-stat-card span {
          display: block;
          margin-bottom: 8px;
          color: var(--notif-ink-soft);
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        .notif-stat-card strong {
          color: var(--notif-ink);
          font-family: var(--yc-display, var(--heading), inherit);
          font-size: clamp(30px, 3vw, 44px);
          font-weight: 800;
          line-height: 1;
          letter-spacing: -0.04em;
        }

        .notif-layout {
          display: grid;
          grid-template-columns: minmax(0, 1.2fr) minmax(350px, 0.8fr);
          align-items: start;
          gap: 20px;
        }

        .notif-panel,
        .notif-form-card {
          min-width: 0;
          padding: clamp(17px, 1.8vw, 24px);
          border: 1px solid rgba(171, 181, 211, 0.72);
          border-radius: clamp(24px, 2vw, 32px);
          background:
            linear-gradient(145deg, rgba(255, 255, 255, 0.99), rgba(244, 249, 255, 0.98));
          box-shadow:
            9px 11px 0 #d1dcfa,
            0 24px 42px rgba(34, 38, 110, 0.1);
        }

        .notif-form-card {
          background:
            linear-gradient(145deg, #f4fbff 0%, #f8f1ff 56%, #fffaf0 100%);
          box-shadow:
            9px 11px 0 #c9ddf5,
            0 24px 42px rgba(34, 38, 110, 0.1);
        }

        .notif-section-heading {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
          margin-bottom: 18px;
        }

        .notif-section-heading h2,
        .notif-section-heading h3 {
          margin: 0 0 6px;
          color: var(--notif-ink);
          font-family: var(--yc-display, var(--heading), inherit);
          font-size: clamp(24px, 2.1vw, 34px);
          font-weight: 760;
          line-height: 0.98;
          letter-spacing: -0.035em;
        }

        .notif-section-heading p {
          max-width: 640px;
          margin: 0;
          color: var(--notif-ink-soft);
          font-size: 13px;
          line-height: 1.55;
        }

        .notif-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }

        .notif-filter-grid {
          display: grid;
          grid-template-columns: minmax(220px, 1.6fr) 160px 130px auto;
          gap: 10px;
          margin-bottom: 18px;
          padding: 13px;
          border: 1px solid rgba(171, 181, 211, 0.55);
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.72);
        }

        .notif-form-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }

        .notif-field {
          display: flex;
          min-width: 0;
          flex-direction: column;
          gap: 7px;
        }

        .notif-field-full {
          grid-column: 1 / -1;
        }

        .notif-field > span {
          color: #334164;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 0.015em;
        }

        .notif-field b {
          margin-left: 3px;
          color: #dc3f67;
        }

        .notif-field input,
        .notif-field select,
        .notif-field textarea,
        .notif-filter-grid input,
        .notif-filter-grid select {
          width: 100%;
          min-width: 0;
          border: 1px solid rgba(159, 169, 205, 0.62);
          border-radius: 14px;
          outline: none;
          color: var(--notif-ink);
          background: rgba(255, 255, 255, 0.86);
          padding: 12px 13px;
          font: inherit;
          transition:
            border-color 180ms ease,
            box-shadow 180ms ease,
            background 180ms ease;
        }

        .notif-field input:hover,
        .notif-field select:hover,
        .notif-field textarea:hover,
        .notif-filter-grid input:hover,
        .notif-filter-grid select:hover {
          border-color: rgba(98, 84, 218, 0.34);
        }

        .notif-field input:focus,
        .notif-field select:focus,
        .notif-field textarea:focus,
        .notif-filter-grid input:focus,
        .notif-filter-grid select:focus {
          border-color: var(--notif-violet);
          background: #ffffff;
          box-shadow: 0 0 0 4px rgba(98, 84, 218, 0.11);
        }

        .notif-field textarea {
          min-height: 125px;
          resize: vertical;
        }

        .notif-field select[multiple] {
          min-height: 180px;
        }

        .notif-helper-text {
          color: var(--notif-ink-soft);
          font-size: 11px;
          font-weight: 750;
          line-height: 1.45;
        }

        .notif-checkbox {
          grid-column: 1 / -1;
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
          padding: 12px 13px;
          border: 1px solid rgba(159, 169, 205, 0.55);
          border-radius: 15px;
          color: #334164;
          background: rgba(255, 255, 255, 0.72);
          font-size: 12px;
          font-weight: 900;
        }

        .notif-checkbox input {
          width: 18px;
          height: 18px;
          accent-color: var(--notif-violet);
        }

        .notif-form-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          margin-top: 18px;
          padding-top: 15px;
          border-top: 1px solid rgba(65, 55, 161, 0.12);
        }

        .notif-list {
          display: grid;
          gap: 14px;
        }

        .notif-card {
          position: relative;
          min-width: 0;
          padding: 16px;
          border: 1px solid rgba(171, 181, 211, 0.64);
          border-radius: 20px;
          color: var(--notif-ink);
          background: #ffffff;
          box-shadow: 4px 5px 0 rgba(185, 215, 255, 0.65);
          transition:
            transform 180ms ease,
            border-color 180ms ease,
            box-shadow 180ms ease;
        }

        .notif-card.unread {
          border-color: rgba(55, 102, 219, 0.35);
          background:
            linear-gradient(145deg, #edf6ff 0%, #ffffff 62%, #f1efff 100%);
          box-shadow:
            6px 7px 0 var(--notif-flat-blue),
            0 15px 26px rgba(55, 102, 219, 0.08);
        }

        .notif-card:hover {
          transform: translateY(-2px);
          border-color: rgba(98, 84, 218, 0.34);
          box-shadow:
            8px 9px 0 rgba(185, 215, 255, 0.78),
            0 18px 30px rgba(15, 20, 75, 0.1);
        }

        .notif-card-top {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 15px;
        }

        .notif-card-top > div:first-child {
          min-width: 0;
        }

        .notif-card h3 {
          margin: 0 0 7px;
          color: var(--notif-ink);
          font-size: clamp(16px, 1.25vw, 19px);
          font-weight: 900;
          line-height: 1.2;
        }

        .notif-card p {
          margin: 0;
          color: #4f5e7f;
          font-size: 13px;
          line-height: 1.58;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }

        .notif-card-actions {
          display: flex;
          flex: 0 0 auto;
          flex-direction: column;
          align-items: flex-end;
          gap: 8px;
        }

        .notif-card-actions .notif-primary-btn,
        .notif-card-actions .notif-soft-btn {
          min-height: 36px;
          padding: 9px 12px;
          font-size: 11px;
        }

        .notif-meta-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 9px;
          margin-top: 15px;
          padding-top: 13px;
          border-top: 1px solid rgba(65, 55, 161, 0.11);
          color: #687492;
          font-size: 11px;
          line-height: 1.4;
        }

        .notif-meta-grid span {
          min-width: 0;
          overflow-wrap: anywhere;
        }

        .notif-meta-grid b {
          color: #334164;
        }

        .notif-pill {
          display: inline-flex;
          align-items: center;
          width: fit-content;
          max-width: 100%;
          border-radius: 999px;
          padding: 6px 10px;
          font-size: 10px;
          font-style: normal;
          font-weight: 900;
          line-height: 1;
          text-transform: capitalize;
          white-space: nowrap;
        }

        .notif-pill-green {
          color: #13736f;
          background: #dff8f3;
        }

        .notif-pill-blue {
          color: #3657b5;
          background: #e5e9ff;
        }

        .notif-pill-red {
          color: #b62f55;
          background: #ffe4ec;
        }

        .notif-pill-gray {
          color: #5f6983;
          background: #edf0f6;
        }

        .notif-empty {
          padding: 30px 22px;
          border: 1px dashed rgba(98, 84, 218, 0.35);
          border-radius: 20px;
          color: var(--notif-ink-soft);
          background:
            linear-gradient(145deg, rgba(237, 248, 255, 0.76), rgba(248, 241, 255, 0.72));
          font-weight: 900;
          text-align: center;
        }

        .notif-note {
          margin-top: 4px;
          padding: 15px;
          border: 1px solid rgba(226, 176, 57, 0.38);
          border-radius: 16px;
          color: #8b5a14;
          background: #fff7d8;
          font-size: 12px;
          font-weight: 800;
          line-height: 1.55;
          box-shadow: 4px 5px 0 rgba(226, 176, 57, 0.16);
        }

        @media (hover: hover) and (pointer: fine) {
          .notif-refresh-btn:hover {
            box-shadow: 7px 8px 0 rgba(52, 43, 120, 0.2);
          }

          .notif-primary-btn:hover {
            box-shadow:
              7px 8px 0 rgba(52, 43, 120, 0.8),
              0 16px 25px rgba(55, 102, 219, 0.2);
          }

          .notif-soft-btn:hover {
            box-shadow: 6px 7px 0 rgba(98, 84, 218, 0.17);
          }
        }

        @media (max-width: 1180px) {
          .notif-layout {
            grid-template-columns: 1fr;
          }

          .notif-form-card {
            order: -1;
          }

          .notif-meta-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 820px) {
          .notif-filter-grid {
            grid-template-columns: minmax(0, 1fr) minmax(130px, 0.55fr);
          }

          .notif-filter-grid .notif-soft-btn {
            width: 100%;
          }
        }

        @media (max-width: 720px) {
          .notifications-page {
            gap: 16px;
          }

          .notif-hero {
            padding: 20px;
            border-radius: 24px;
            box-shadow:
              7px 8px 0 var(--notif-flat-blue),
              0 18px 30px rgba(34, 38, 110, 0.1);
          }

          .notif-hero-content,
          .notif-section-heading,
          .notif-card-top {
            flex-direction: column;
          }

          .notif-hero-content {
            gap: 17px;
          }

          .notif-hero h1 {
            font-size: clamp(30px, 9.4vw, 43px);
          }

          .notif-refresh-btn {
            width: 100%;
          }

          .notif-stats-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 9px;
          }

          .notif-stat-card {
            padding: 14px 12px;
            border-radius: 17px;
            box-shadow:
              4px 5px 0 var(--notif-flat-blue),
              0 12px 20px rgba(15, 20, 75, 0.07);
          }

          .notif-stat-card:nth-child(2) {
            box-shadow:
              4px 5px 0 var(--notif-flat-violet),
              0 12px 20px rgba(15, 20, 75, 0.07);
          }

          .notif-stat-card:nth-child(3) {
            box-shadow:
              4px 5px 0 #aee6d9,
              0 12px 20px rgba(15, 20, 75, 0.07);
          }

          .notif-stat-card span {
            min-height: 28px;
            margin-bottom: 5px;
            font-size: 7px;
            line-height: 1.25;
          }

          .notif-stat-card strong {
            font-size: clamp(24px, 7vw, 32px);
          }

          .notif-panel,
          .notif-form-card {
            padding: 17px;
            border-radius: 23px;
            box-shadow:
              6px 7px 0 #d1dcfa,
              0 16px 28px rgba(34, 38, 110, 0.08);
          }

          .notif-form-card {
            box-shadow:
              6px 7px 0 #c9ddf5,
              0 16px 28px rgba(34, 38, 110, 0.08);
          }

          .notif-filter-grid,
          .notif-form-grid,
          .notif-meta-grid {
            grid-template-columns: 1fr;
          }

          .notif-filter-grid {
            padding: 11px;
          }

          .notif-actions,
          .notif-form-actions,
          .notif-card-actions {
            width: 100%;
            align-items: stretch;
          }

          .notif-actions button,
          .notif-form-actions button,
          .notif-card-actions button {
            width: 100%;
          }

          .notif-form-actions {
            flex-direction: column-reverse;
          }

          .notif-card {
            padding: 14px;
            border-radius: 18px;
          }

          .notif-card-actions {
            flex-direction: row;
            flex-wrap: wrap;
          }

          .notif-card-actions .notif-pill {
            flex: 0 0 auto;
          }
        }

        @media (max-width: 430px) {
          .notif-stats-grid {
            grid-template-columns: 1fr;
          }

          .notif-stat-card span {
            min-height: 0;
            font-size: 8px;
          }

          .notif-form-grid {
            gap: 12px;
          }

          .notif-card-actions {
            display: grid;
            grid-template-columns: 1fr;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .notifications-page *,
          .notifications-page *::before,
          .notifications-page *::after {
            scroll-behavior: auto !important;
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
          }
        }
      `}</style>

      <div className="notif-hero">
        <div className="notif-hero-content">
          <div>
            <span className="notif-kicker">Notification Center</span>
            <h1>Tenant Notifications & Announcements</h1>
            <p>
              HR, Admin, Super Admin, Managing Director, Manager and Team Leader rank users
              can send notifications to everyone in their own tenant only. Notifications
              are shown in the bell, notification center and dashboard popup.
            </p>
          </div>

          <button type="button" className="notif-refresh-btn" onClick={loadNotifications}>
            Refresh
          </button>
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

      <div className="notif-layout">
        <div className="notif-panel">
          <div className="notif-section-heading">
            <div>
              <h2>Notifications</h2>
              <p>
                View received tenant notifications, filter unread messages and mark them as read.
              </p>
            </div>

            <div className="notif-actions">
              <button type="button" className="notif-soft-btn" onClick={handleMarkAllRead}>
                Mark All Read
              </button>
            </div>
          </div>

          <div className="notif-filter-grid">
            <input
              name="q"
              value={filters.q}
              onChange={handleFilterChange}
              placeholder="Search notification title, message, type..."
            />

            <select name="unread" value={filters.unread} onChange={handleFilterChange}>
              <option value="">All</option>
              <option value="true">Unread Only</option>
            </select>

            <select name="limit" value={filters.limit} onChange={handleFilterChange}>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="200">200</option>
            </select>

            <button type="button" className="notif-soft-btn" onClick={loadNotifications}>
              Apply
            </button>
          </div>

          {loading ? (
            <div className="notif-empty">Loading notifications...</div>
          ) : filteredItems.length ? (
            <div className="notif-list">
              {filteredItems.map((item) => (
                <NotificationCard
                  key={item._id || item.id || `${item.title}-${item.created_at}`}
                  item={item}
                  onMarkRead={handleMarkRead}
                  onNavigate={handleNavigate}
                />
              ))}
            </div>
          ) : (
            <div className="notif-empty">No notifications found.</div>
          )}
        </div>

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

              <div className="notif-form-actions">
                <button type="button" className="notif-soft-btn" onClick={resetForm}>
                  Reset
                </button>
                <button type="submit" className="notif-primary-btn" disabled={saving}>
                  {saving ? 'Sending...' : 'Send Notification'}
                </button>
              </div>
            </form>
          ) : (
            <div className="notif-note">
              You can view notifications, but your role or designation cannot create new notifications.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}