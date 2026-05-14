import {
  BarChart3,
  Bell,
  Briefcase,
  CalendarDays,
  CheckCheck,
  Clock,
  LayoutDashboard,
  LogOut,
  Menu,
  User,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  clearSession,
  getInitials,
  getProfilePhotoUrl,
  refreshCurrentSession,
} from '../api/client';
import {
  moduleList,
  getDisplayRole,
  getEmployeeCapabilities,
} from '../data/modules';

function normalizeRoleValue(role) {
  return String(role || '')
    .trim()
    .toLowerCase()
    .replaceAll('-', '_')
    .replaceAll(' ', '_');
}

function normalizeRoles(user) {
  const userRoles = user?.roles;

  if (Array.isArray(userRoles)) {
    return userRoles
      .map((role) => normalizeRoleValue(role))
      .filter(Boolean);
  }

  if (typeof userRoles === 'string') {
    return userRoles
      .split(',')
      .map((role) => normalizeRoleValue(role))
      .filter(Boolean);
  }

  const singleRole = normalizeRoleValue(user?.role);

  return singleRole ? [singleRole] : [];
}

function profilePhotoValue(record = {}) {
  return (
    record.avatar ||
    record.profile_photo ||
    record.profile_picture ||
    record.photo ||
    record.image ||
    record.picture ||
    ''
  );
}

function applyProfilePhotoAliases(record = {}, photoValue = '') {
  const photo = String(photoValue || profilePhotoValue(record) || '').trim();

  if (photo) {
    record.avatar = photo;
    record.profile_photo = photo;
    record.profile_picture = photo;
    record.photo = photo;
  }

  return record;
}

function getStoredEmployee() {
  try {
    return JSON.parse(localStorage.getItem('sds_hrms_employee') || '{}');
  } catch {
    return {};
  }
}

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('sds_hrms_user') || '{}');
  } catch {
    return {};
  }
}

function getUserPhoto(user = {}) {
  const storedUser = getStoredUser();
  const storedEmployee = getStoredEmployee();

  const employee =
    user.employee ||
    user.employee_summary ||
    user.employee_profile ||
    storedUser.employee ||
    storedUser.employee_summary ||
    storedUser.employee_profile ||
    storedEmployee ||
    {};

  return (
    profilePhotoValue(employee) ||
    profilePhotoValue(user) ||
    profilePhotoValue(storedEmployee) ||
    profilePhotoValue(storedUser)
  );
}

function userDisplayName(user = {}) {
  return (
    user.name ||
    user.full_name ||
    user.display_name ||
    user.email ||
    'User'
  );
}

function UserAvatar({ user = {}, size = 'sm' }) {
  const [imageFailed, setImageFailed] = useState(false);

  const photo = getUserPhoto(user);
  const photoUrl = photo && !imageFailed ? getProfilePhotoUrl({ avatar: photo }) : '';
  const name = userDisplayName(user);

  useEffect(() => {
    setImageFailed(false);
  }, [photo]);

  return (
    <span className={`layout-avatar layout-avatar-${size}`}>
      {photoUrl ? (
        <img
          src={photoUrl}
          alt={name}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <b>{getInitials(name)}</b>
      )}
    </span>
  );
}

function roleLabel(role = '') {
  const normalized = normalizeRoleValue(role);

  if (normalized === 'team_leader') {
    return 'Team Leader Capability';
  }

  if (normalized === 'reporting_officer') {
    return 'Reporting Officer Capability';
  }

  if (normalized === 'ro') {
    return 'Reporting Officer Capability';
  }

  return normalized
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function moduleGroup(key) {
  if (
    [
      'companies',
      'users',
      'password_requests',
      'system_settings',
      'audit_logs',
    ].includes(key)
  ) {
    return 'Administration';
  }

  if (
    [
      'employees',
      'departments',
      'designations',
      'states',
    ].includes(key)
  ) {
    return 'Employee Setup';
  }

  if (key === 'projects') {
    return 'Projects';
  }

  if (
    [
      'attendance',
      'attendance_logs',
      'attendance_mode_requests',
      'holiday_calendar',
      'compoff_credits',
      'team_approvals',
      'leave_requests',
      'leave_balances',
      'leave_types',
      'application_status',
    ].includes(key)
  ) {
    return 'Attendance & Leave';
  }

  if (key === 'reports') {
    return 'Reports';
  }

  if (['payroll_runs', 'payslips', 'expenses'].includes(key)) {
    return 'Payroll & Finance';
  }

  if (
    [
      'job_openings',
      'candidates',
      'trainings',
      'performance_reviews',
    ].includes(key)
  ) {
    return 'Talent & Performance';
  }

  if (
    [
      'assets',
      'tickets',
      'notifications',
      'policies',
      'documents',
    ].includes(key)
  ) {
    return 'Support & Records';
  }

  if (key === 'profile') {
    return 'Account';
  }

  return 'Modules';
}

function groupOrder(group) {
  const order = {
    Administration: 1,
    'Employee Setup': 2,
    Projects: 3,
    'Attendance & Leave': 4,
    Reports: 5,
    'Payroll & Finance': 6,
    'Talent & Performance': 7,
    'Support & Records': 8,
    Account: 9,
    Modules: 99,
  };

  return order[group] || 99;
}

function buildCapabilityText(user) {
  const capabilities = getEmployeeCapabilities(user);
  const items = [];

  if (capabilities.isTeamLeader) {
    items.push('Team Leader');
  }

  if (capabilities.isReportingOfficer) {
    items.push('Reporting Officer');
  }

  if (capabilities.isHrAdmin) {
    items.push('HR Records');
  }

  return items.length ? items.join(' + ') : '';
}

function formatNotificationTime(value) {
  if (!value) {
    return '';
  }

  try {
    const date = new Date(value);
    return date.toLocaleString();
  } catch {
    return '';
  }
}

function notificationTarget(meta = {}) {
  const target = String(meta.target || meta.page || '').trim();

  if (
    [
      'team_approvals',
      'team-approvals',
      'team_approval',
      'team-approval',
      'leave_approval',
      'leave-approval',
      'leave_approvals',
      'leave-approvals',
      'leave_approval_inbox',
      'approval_inbox',
      'approval-inbox',
      'pending_approvals',
      'pending-approvals',
      'pending_leave_approvals',
      'pending-leave-approvals',
      'tl_approvals',
      'team_leader_approvals',
      'ro_approvals',
      'reporting_officer_approvals',
      'hr_leave_records',
      'hr-leave-records',
      'leave_records_panel',
      'leave-records-panel',
      'hr_record_panel',
      'hr-record-panel',
    ].includes(target)
  ) {
    return 'team_approvals';
  }

  if (
    meta.leave_request_id ||
    meta.team_approval_id ||
    meta.team_approval_request_id ||
    meta.approval_stage ||
    meta.pending_approver_role ||
    meta.approved_by_team_leader ||
    meta.approved_by_reporting_officer ||
    meta.hr_notified ||
    meta.hr_notified_at ||
    meta.hr_record_notification_sent ||
    meta.hr_record_status
  ) {
    const stage = String(meta.approval_stage || '').toLowerCase();
    const approverRole = String(meta.pending_approver_role || '').toLowerCase();
    const notificationType = String(meta.notification_type || meta.type || '').toLowerCase();

    if (
      stage === 'team_leader' ||
      stage === 'reporting_officer' ||
      stage === 'hr' ||
      approverRole === 'team_leader' ||
      approverRole === 'reporting_officer' ||
      approverRole === 'hr' ||
      notificationType.includes('approval') ||
      notificationType.includes('leave_record') ||
      notificationType.includes('hr_record')
    ) {
      return 'team_approvals';
    }

    return 'application_status';
  }

  if (
    [
      'application_status',
      'application-status',
      'request_status',
      'request-status',
      'my_requests',
      'my-requests',
    ].includes(target)
  ) {
    return 'application_status';
  }

  if (
    [
      'performance',
      'performance_review',
      'performance_reviews',
      'team_performance',
      'team_leader_performance',
      'reporting_officer_performance',
    ].includes(target)
  ) {
    return 'performance_reviews';
  }

  if (
    [
      'project',
      'projects',
      'project_progress',
      'project_analytics',
      'department_project_graph',
      'project_wise_graph',
      'team_project_graph',
      'project_team_tree',
      'team_hierarchy',
      'team_root_map',
    ].includes(target)
  ) {
    return 'projects';
  }

  if (meta.performance_review_id || meta.review_target_type) {
    return 'performance_reviews';
  }

  if (meta.attendance_mode_request_id) {
    return 'application_status';
  }

  if (meta.password_request_id) {
    return 'application_status';
  }

  if (meta.ticket_id) {
    return 'application_status';
  }

  if (meta.compoff_id || meta.compoff_credit_id) {
    return 'application_status';
  }

  if (
    meta.project_id ||
    meta.project_progress_id ||
    meta.assigned_employee_ids ||
    meta.collaborator_ids
  ) {
    return 'projects';
  }

  return '';
}

export default function AppLayout({ user, setUser, page, setPage, children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notificationCount, setNotificationCount] = useState(0);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState('');
  const notificationRef = useRef(null);

  const safeUser = {
    ...(user || {}),
    roles: normalizeRoles(user),
  };

  applyProfilePhotoAliases(safeUser, getUserPhoto(safeUser));

  const modules = moduleList(safeUser).filter(
    (module) => module[0] !== 'dashboard',
  );

  const groupedModules = useMemo(() => {
    const grouped = modules.reduce((acc, module) => {
      const group = moduleGroup(module[0]);

      if (!acc[group]) {
        acc[group] = [];
      }

      acc[group].push(module);
      return acc;
    }, {});

    return Object.entries(grouped)
      .sort(([groupA], [groupB]) => groupOrder(groupA) - groupOrder(groupB))
      .map(([group, groupModules]) => ({
        group,
        modules: groupModules,
      }));
  }, [modules]);

  const currentTitle =
    page === 'dashboard'
      ? 'Dashboard'
      : modules.find((module) => module[0] === page)?.[1] ||
        'Access Restricted';

  const displayRole = getDisplayRole(safeUser);
  const capabilityText = buildCapabilityText(safeUser);

  async function loadNotifications({ silent = false } = {}) {
    if (!safeUser?._id && !safeUser?.email) {
      return;
    }

    try {
      if (!silent) {
        setNotificationLoading(true);
      }

      const data = await api('/notifications?limit=20');

      setNotifications(data.items || []);
      setNotificationCount(Number(data.unread_count || 0));
      setNotificationMessage('');
    } catch (error) {
      setNotificationMessage(error.message || 'Unable to load notifications');
    } finally {
      setNotificationLoading(false);
    }
  }

  useEffect(() => {
    async function syncProfileSession() {
      try {
        const data = await refreshCurrentSession();

        if (data?.user && typeof setUser === 'function') {
          const syncedUser = {
            ...data.user,
            employee: data.employee || {},
            employee_summary: data.employee || {},
            employee_profile: data.employee || {},
          };

          applyProfilePhotoAliases(
            syncedUser,
            profilePhotoValue(data.employee) || profilePhotoValue(data.user),
          );

          if (syncedUser.employee && typeof syncedUser.employee === 'object') {
            applyProfilePhotoAliases(
              syncedUser.employee,
              profilePhotoValue(data.employee) || profilePhotoValue(data.user),
            );
          }

          if (syncedUser.employee_summary && typeof syncedUser.employee_summary === 'object') {
            applyProfilePhotoAliases(
              syncedUser.employee_summary,
              profilePhotoValue(data.employee) || profilePhotoValue(data.user),
            );
          }

          if (syncedUser.employee_profile && typeof syncedUser.employee_profile === 'object') {
            applyProfilePhotoAliases(
              syncedUser.employee_profile,
              profilePhotoValue(data.employee) || profilePhotoValue(data.user),
            );
          }

const compactSyncedUser = {
  id: syncedUser.id || syncedUser._id || '',
  _id: syncedUser._id || syncedUser.id || '',
  name: syncedUser.name || data.employee?.employee_name || '',
  email: syncedUser.email || '',
  role: syncedUser.role || '',
  roles: Array.isArray(syncedUser.roles) ? syncedUser.roles : [],
  tenant_id: syncedUser.tenant_id || data.employee?.tenant_id || '',
  employee_id: syncedUser.employee_id || data.employee?.id || data.employee?._id || '',
  employee_code: syncedUser.employee_code || data.employee?.employee_code || '',
  department_name: syncedUser.department_name || data.employee?.department_name || '',
  designation_name: syncedUser.designation_name || data.employee?.designation_name || '',
  avatar: profilePhotoValue(data.employee) || profilePhotoValue(data.user),
  profile_photo: profilePhotoValue(data.employee) || profilePhotoValue(data.user),
  profile_picture: profilePhotoValue(data.employee) || profilePhotoValue(data.user),
  photo: profilePhotoValue(data.employee) || profilePhotoValue(data.user),
};

const compactSyncedEmployee = {
  id: data.employee?.id || data.employee?._id || '',
  _id: data.employee?._id || data.employee?.id || '',
  employee_name: data.employee?.employee_name || data.employee?.name || '',
  employee_code: data.employee?.employee_code || '',
  email: data.employee?.email || '',
  phone: data.employee?.phone || '',
  tenant_id: data.employee?.tenant_id || '',
  department_id: data.employee?.department_id || '',
  department_name: data.employee?.department_name || '',
  designation_id: data.employee?.designation_id || '',
  designation_name: data.employee?.designation_name || '',
  is_team_leader: Boolean(data.employee?.is_team_leader),
  is_reporting_officer: Boolean(data.employee?.is_reporting_officer),
  is_it_support_head: Boolean(data.employee?.is_it_support_head),
  is_it_support_member: Boolean(data.employee?.is_it_support_member),
  avatar: profilePhotoValue(data.employee),
  profile_photo: profilePhotoValue(data.employee),
  profile_picture: profilePhotoValue(data.employee),
  photo: profilePhotoValue(data.employee),
};

try {
  localStorage.setItem('sds_hrms_user', JSON.stringify(compactSyncedUser));
  localStorage.setItem('sds_hrms_employee', JSON.stringify(compactSyncedEmployee));
} catch (error) {
  console.warn('Unable to refresh compact session in localStorage', error);
}

setUser(syncedUser);
        }
      } catch {
        // Ignore session refresh failure here; api() handles expired sessions globally.
      }
    }

    syncProfileSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadNotifications({ silent: true });

    const interval = window.setInterval(() => {
      loadNotifications({ silent: true });
    }, 30000);

    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeUser?._id, safeUser?.email]);

  useEffect(() => {
    function handleOutsideClick(event) {
      if (
        notificationRef.current &&
        !notificationRef.current.contains(event.target)
      ) {
        setNotificationOpen(false);
      }
    }

    if (notificationOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }

    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [notificationOpen]);

  function goTo(nextPage) {
    if (typeof setPage === 'function') {
      setPage(nextPage || 'dashboard');
    }

    setSidebarOpen(false);
    setNotificationOpen(false);
  }

  function logout() {
    clearSession();

    if (typeof setUser === 'function') {
      setUser(null);
    }

    if (typeof setPage === 'function') {
      setPage('dashboard');
    }

    setSidebarOpen(false);
    setNotificationOpen(false);
  }

  async function toggleNotifications() {
    const nextOpen = !notificationOpen;
    setNotificationOpen(nextOpen);

    if (nextOpen) {
      await loadNotifications();
    }
  }

  async function markNotificationRead(notification) {
    if (!notification?._id) {
      return;
    }

    try {
      await api(`/notifications/${notification._id}/read`, {
        method: 'PATCH',
      });

      const target = notificationTarget({
        ...(notification.meta || {}),
        target: notification.target || notification.meta?.target,
        page: notification.page || notification.meta?.page,
        type: notification.type || notification.meta?.type,
      });

      if (target) {
        goTo(target);
      }

      await loadNotifications({ silent: true });
    } catch (error) {
      setNotificationMessage(error.message || 'Unable to update notification');
    }
  }

  async function markAllNotificationsRead() {
    try {
      await api('/notifications/read_all', {
        method: 'PATCH',
      });

      await loadNotifications({ silent: true });
    } catch (error) {
      setNotificationMessage(error.message || 'Unable to mark all as read');
    }
  }

  return (
    <div className="app-shell layout-photo-aware">
      <style>{`
        .layout-photo-aware .side-brand {
          align-items: center;
        }

        .layout-avatar {
          overflow: hidden;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #eef2ff, #ecfdf5);
          color: #4338ca;
          border: 2px solid #ffffff;
          box-shadow: 0 10px 22px rgba(15, 23, 42, .12);
          font-weight: 900;
          flex: 0 0 auto;
        }

        .layout-avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .layout-avatar b {
          font-size: inherit;
          line-height: 1;
        }

        .layout-avatar-sm {
          width: 34px;
          height: 34px;
          font-size: 11px;
        }

        .layout-avatar-md {
          width: 46px;
          height: 46px;
          font-size: 14px;
        }

        .layout-sidebar-profile {
          margin: 14px 0 10px;
          border: 1px solid rgba(255,255,255,.14);
          border-radius: 18px;
          padding: 11px;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 10px;
          align-items: center;
          background: rgba(255,255,255,.06);
        }

        .layout-sidebar-profile strong {
          display: block;
          color: #ffffff;
          font-size: 13px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .layout-sidebar-profile small {
          display: block;
          margin-top: 3px;
          color: rgba(255,255,255,.68);
          font-size: 11px;
          line-height: 1.35;
        }

        .layout-photo-aware .user-chip {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          min-width: 0;
        }

        .layout-photo-aware .user-chip span:last-child {
          max-width: 170px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .layout-photo-aware .notification-item {
          text-align: left;
        }

        @media (max-width: 720px) {
          .layout-photo-aware .user-chip span:last-child {
            max-width: 110px;
          }
        }
      `}</style>

      <button
        type="button"
        className={`mobile-menu-btn ${sidebarOpen ? 'active' : ''}`}
        onClick={() => setSidebarOpen((value) => !value)}
        aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
      >
        {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {sidebarOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close menu"
        />
      )}

      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="side-brand">
          <span>SDS</span>

          <div>
            <b>HRMS</b>
            <small>Attendance • Leave • Projects</small>
          </div>
        </div>

        <div className="layout-sidebar-profile">
          <UserAvatar user={safeUser} size="md" />

          <div>
            <strong>{safeUser?.name || safeUser?.email || 'User'}</strong>
            <small>
              {displayRole}
              {capabilityText ? ` • ${capabilityText}` : ''}
            </small>
          </div>
        </div>

        <nav>
          <button
            type="button"
            className={page === 'dashboard' ? 'active' : ''}
            onClick={() => goTo('dashboard')}
          >
            <LayoutDashboard size={18} /> Dashboard
          </button>

          {groupedModules.map(({ group, modules: groupModules }) => (
            <div className="nav-group" key={group}>
              <div className="nav-group-title">{group}</div>

              {groupModules.map(([key, title, Icon]) => (
                <button
                  type="button"
                  key={key}
                  className={page === key ? 'active' : ''}
                  onClick={() => goTo(key)}
                >
                  {Icon ? <Icon size={18} /> : null}
                  {title}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <button
          type="button"
          className="logout"
          onClick={logout}
          aria-label="Logout"
        >
          <LogOut size={18} /> Logout
        </button>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h2>{currentTitle}</h2>

            <p>
              {displayRole}
              {capabilityText ? ` • ${capabilityText}` : ''}
              {safeUser?.tenant_id ? ` • ${safeUser.tenant_id}` : ''}
            </p>

            {safeUser.roles.length > 0 && (
              <small>
                Access: {safeUser.roles.map(roleLabel).join(', ')}
              </small>
            )}
          </div>

          <div className="topbar-actions">
            <div className="notification-wrap" ref={notificationRef}>
              <button
                type="button"
                className={`notification-btn ${notificationOpen ? 'active' : ''}`}
                onClick={toggleNotifications}
                aria-label="Notifications"
              >
                <Bell size={17} />

                {notificationCount > 0 && (
                  <span className="notification-badge">
                    {notificationCount > 99 ? '99+' : notificationCount}
                  </span>
                )}
              </button>

              {notificationOpen && (
                <div className="notification-panel">
                  <div className="notification-head">
                    <div>
                      <b>Notifications</b>
                      <small>{notificationCount} unread</small>
                    </div>

                    <button
                      type="button"
                      className="notification-mark-all"
                      onClick={markAllNotificationsRead}
                      disabled={!notificationCount}
                    >
                      <CheckCheck size={14} />
                      Mark all read
                    </button>
                  </div>

                  {notificationMessage && (
                    <div className="notification-message">
                      {notificationMessage}
                    </div>
                  )}

                  <div className="notification-list">
                    {notificationLoading && (
                      <div className="notification-empty">
                        Loading notifications...
                      </div>
                    )}

                    {!notificationLoading && !notifications.length && (
                      <div className="notification-empty">
                        No notifications found.
                      </div>
                    )}

                    {!notificationLoading &&
                      notifications.map((notification) => (
                        <button
                          type="button"
                          key={notification._id}
                          className={`notification-item ${notification.read ? 'read' : 'unread'}`}
                          onClick={() => markNotificationRead(notification)}
                        >
                          <span className="notification-dot" />

                          <span>
                            <b>{notification.title || 'Notification'}</b>
                            <small>{notification.body || 'No details available.'}</small>
                            <em>{formatNotificationTime(notification.created_at)}</em>
                          </span>
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>

            <div className="user-chip">
              <UserAvatar user={safeUser} size="sm" />
              <span>{safeUser?.name || safeUser?.email || 'User'}</span>
            </div>
          </div>
        </header>

        {children}
      </main>
    </div>
  );
}