import { useEffect, useMemo, useState } from 'react';
import {
  api,
  currentUser,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../api/client';
import { canCreateNotifications } from '../data/modules';

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

function NotificationCard({ item, onMarkRead }) {
  const isUnread = item.read !== true && item.status !== 'read';

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

export default function Notifications() {
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

  const [message, setMessage] = useState({
    type: '',
    text: '',
  });

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

  const showMessage = (type, text) => {
    setMessage({ type, text });

    window.clearTimeout(window.__notificationMessageTimer);
    window.__notificationMessageTimer = window.setTimeout(() => {
      setMessage({ type: '', text: '' });
    }, 4000);
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
      showMessage('error', error.message || 'Unable to load notifications.');
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
      showMessage('error', error.message || 'Unable to load notification target options.');
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
      showMessage('error', 'You do not have permission to create notifications.');
      return;
    }

    const title = String(form.title || '').trim();
    const body = String(form.body || '').trim();

    if (!title || !body) {
      showMessage('error', 'Title and message are required.');
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

      showMessage('success', 'Notification sent successfully.');
    } catch (error) {
      showMessage('error', error.message || 'Unable to create notification.');
    } finally {
      setSaving(false);
    }
  };

  const handleMarkRead = async (item) => {
    const id = item._id || item.id;

    if (!id) {
      return;
    }

    try {
      await markNotificationRead(id);
      await loadNotifications();
      showMessage('success', 'Notification marked as read.');
    } catch (error) {
      showMessage('error', error.message || 'Unable to mark notification as read.');
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await markAllNotificationsRead();
      await loadNotifications();
      showMessage('success', 'All notifications marked as read.');
    } catch (error) {
      showMessage('error', error.message || 'Unable to mark all notifications as read.');
    }
  };

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
          display: flex;
          flex-direction: column;
          gap: 18px;
          color: #172033;
        }

        .notif-hero {
          position: relative;
          overflow: hidden;
          border-radius: 28px;
          padding: 24px;
          background:
            radial-gradient(circle at top left, rgba(250, 204, 21, .26), transparent 34%),
            linear-gradient(135deg, #111827 0%, #312e81 52%, #2563eb 100%);
          color: #fff;
          box-shadow: 0 22px 55px rgba(17, 24, 39, .18);
        }

        .notif-hero::after {
          content: "";
          position: absolute;
          width: 240px;
          height: 240px;
          right: -80px;
          top: -90px;
          border-radius: 999px;
          background: rgba(255,255,255,.13);
        }

        .notif-hero-content {
          position: relative;
          z-index: 1;
          display: flex;
          justify-content: space-between;
          gap: 20px;
          align-items: flex-start;
        }

        .notif-kicker {
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          padding: 7px 12px;
          background: rgba(255,255,255,.14);
          color: #dbeafe;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: .08em;
          text-transform: uppercase;
        }

        .notif-hero h1 {
          margin: 14px 0 8px;
          font-size: clamp(28px, 4vw, 42px);
          line-height: 1.05;
        }

        .notif-hero p {
          margin: 0;
          color: rgba(255,255,255,.78);
          max-width: 800px;
          line-height: 1.65;
        }

        .notif-refresh-btn,
        .notif-primary-btn,
        .notif-soft-btn {
          border: 0;
          cursor: pointer;
          font-weight: 900;
          transition: transform .18s ease, box-shadow .18s ease, background .18s ease;
        }

        .notif-refresh-btn:hover,
        .notif-primary-btn:hover,
        .notif-soft-btn:hover {
          transform: translateY(-1px);
        }

        .notif-refresh-btn {
          border-radius: 16px;
          padding: 11px 15px;
          background: rgba(255,255,255,.16);
          color: #fff;
          border: 1px solid rgba(255,255,255,.22);
        }

        .notif-primary-btn {
          border-radius: 15px;
          padding: 12px 16px;
          background: #2563eb;
          color: #fff;
          box-shadow: 0 12px 24px rgba(37, 99, 235, .22);
        }

        .notif-primary-btn:disabled {
          opacity: .65;
          cursor: not-allowed;
        }

        .notif-soft-btn {
          border-radius: 14px;
          padding: 10px 13px;
          background: #eef4ff;
          color: #1d4ed8;
        }

        .notif-stats-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 14px;
        }

        .notif-stat-card {
          background: #fff;
          border: 1px solid #e7edf7;
          border-radius: 22px;
          padding: 18px;
          box-shadow: 0 14px 35px rgba(15, 23, 42, .07);
        }

        .notif-stat-card span {
          display: block;
          color: #64748b;
          font-size: 13px;
          font-weight: 900;
          margin-bottom: 8px;
        }

        .notif-stat-card strong {
          font-size: 30px;
          color: #0f172a;
        }

        .notif-alert {
          border-radius: 18px;
          padding: 13px 16px;
          font-weight: 900;
          animation: notifSlideDown .24s ease both;
        }

        .notif-alert.success {
          color: #166534;
          background: #dcfce7;
          border: 1px solid #bbf7d0;
        }

        .notif-alert.error {
          color: #991b1b;
          background: #fee2e2;
          border: 1px solid #fecaca;
        }

        @keyframes notifSlideDown {
          from {
            opacity: 0;
            transform: translateY(-8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .notif-layout {
          display: grid;
          grid-template-columns: minmax(0, 1.2fr) minmax(340px, .8fr);
          gap: 18px;
          align-items: start;
        }

        .notif-panel,
        .notif-form-card {
          background: #fff;
          border: 1px solid #e7edf7;
          border-radius: 26px;
          padding: 18px;
          box-shadow: 0 18px 45px rgba(15, 23, 42, .08);
        }

        .notif-section-heading {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
          margin-bottom: 16px;
        }

        .notif-section-heading h2,
        .notif-section-heading h3 {
          margin: 0 0 5px;
          color: #0f172a;
        }

        .notif-section-heading p {
          margin: 0;
          color: #64748b;
          line-height: 1.55;
        }

        .notif-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }

        .notif-filter-grid {
          display: grid;
          grid-template-columns: 1.6fr 160px 130px auto;
          gap: 10px;
          margin-bottom: 16px;
        }

        .notif-form-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
        }

        .notif-field {
          display: flex;
          flex-direction: column;
          gap: 7px;
        }

        .notif-field-full {
          grid-column: 1 / -1;
        }

        .notif-field span {
          color: #334155;
          font-weight: 900;
          font-size: 13px;
        }

        .notif-field b {
          color: #dc2626;
          margin-left: 3px;
        }

        .notif-field input,
        .notif-field select,
        .notif-field textarea,
        .notif-filter-grid input,
        .notif-filter-grid select {
          width: 100%;
          border: 1px solid #dbe4f0;
          background: #f8fafc;
          color: #172033;
          border-radius: 15px;
          padding: 12px 13px;
          outline: none;
          font: inherit;
          transition: border .18s ease, box-shadow .18s ease, background .18s ease;
        }

        .notif-field textarea {
          resize: vertical;
          min-height: 120px;
        }

                .notif-field select[multiple] {
          min-height: 180px;
        }

        .notif-helper-text {
          color: #64748b;
          font-size: 12px;
          font-weight: 800;
          line-height: 1.4;
        }

        .notif-field input:focus,
        .notif-field select:focus,
        .notif-field textarea:focus,
        .notif-filter-grid input:focus,
        .notif-filter-grid select:focus {
          border-color: #2563eb;
          box-shadow: 0 0 0 4px rgba(37, 99, 235, .12);
          background: #fff;
        }

        .notif-checkbox {
          grid-column: 1 / -1;
          display: flex;
          align-items: center;
          gap: 10px;
          border: 1px solid #e7edf7;
          background: #f8fafc;
          border-radius: 16px;
          padding: 12px;
          color: #334155;
          font-weight: 900;
        }

        .notif-checkbox input {
          width: 18px;
          height: 18px;
        }

        .notif-form-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          margin-top: 16px;
        }

        .notif-list {
          display: grid;
          gap: 12px;
        }

        .notif-card {
          border: 1px solid #e7edf7;
          background: #fff;
          border-radius: 20px;
          padding: 15px;
          transition: transform .18s ease, border .18s ease, box-shadow .18s ease;
        }

        .notif-card.unread {
          border-color: #bfdbfe;
          background: linear-gradient(180deg, #eff6ff 0%, #ffffff 100%);
          box-shadow: 0 12px 28px rgba(37, 99, 235, .08);
        }

        .notif-card:hover {
          transform: translateY(-1px);
          box-shadow: 0 14px 32px rgba(15, 23, 42, .08);
        }

        .notif-card-top {
          display: flex;
          justify-content: space-between;
          gap: 14px;
          align-items: flex-start;
        }

        .notif-card h3 {
          margin: 0 0 6px;
          color: #0f172a;
          font-size: 18px;
        }

        .notif-card p {
          margin: 0;
          color: #475569;
          line-height: 1.55;
          white-space: pre-wrap;
        }

        .notif-card-actions {
          display: flex;
          flex-direction: column;
          gap: 8px;
          align-items: flex-end;
        }

        .notif-meta-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
          margin-top: 14px;
          padding-top: 12px;
          border-top: 1px solid #edf2f7;
          color: #64748b;
          font-size: 13px;
        }

        .notif-meta-grid b {
          color: #334155;
        }

        .notif-pill {
          display: inline-flex;
          align-items: center;
          width: fit-content;
          border-radius: 999px;
          padding: 6px 10px;
          font-size: 12px;
          font-style: normal;
          font-weight: 900;
          text-transform: capitalize;
        }

        .notif-pill-green {
          color: #166534;
          background: #dcfce7;
        }

        .notif-pill-blue {
          color: #1d4ed8;
          background: #dbeafe;
        }

        .notif-pill-red {
          color: #be123c;
          background: #ffe4e6;
        }

        .notif-pill-gray {
          color: #475569;
          background: #f1f5f9;
        }

        .notif-empty {
          border: 1px dashed #cbd5e1;
          background: #f8fafc;
          color: #64748b;
          padding: 28px;
          text-align: center;
          border-radius: 20px;
          font-weight: 900;
        }

        .notif-note {
          margin-top: 14px;
          padding: 13px;
          border-radius: 16px;
          background: #fffbeb;
          color: #92400e;
          border: 1px solid #fde68a;
          font-weight: 800;
          line-height: 1.5;
        }

        @media (max-width: 1100px) {
          .notif-layout {
            grid-template-columns: 1fr;
          }

          .notif-stats-grid,
          .notif-meta-grid {
            grid-template-columns: 1fr 1fr;
          }
        }

        @media (max-width: 720px) {
          .notif-hero-content,
          .notif-section-heading,
          .notif-card-top {
            flex-direction: column;
          }

          .notif-filter-grid,
          .notif-form-grid,
          .notif-stats-grid,
          .notif-meta-grid {
            grid-template-columns: 1fr;
          }

          .notif-actions,
          .notif-form-actions,
          .notif-card-actions {
            width: 100%;
            align-items: stretch;
          }

          .notif-actions button,
          .notif-form-actions button,
          .notif-card-actions button,
          .notif-refresh-btn {
            width: 100%;
          }

          .notif-hero {
            padding: 20px;
            border-radius: 22px;
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

      {message.text ? (
        <div className={`notif-alert ${message.type}`}>
          {message.text}
        </div>
      ) : null}

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
            <form onSubmit={handleCreateNotification}>
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
