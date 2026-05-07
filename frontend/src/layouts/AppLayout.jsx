import {
  BarChart3,
  CalendarDays,
  Clock,
  LayoutDashboard,
  LogOut,
  Menu,
  User,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { clearSession } from '../api/client';
import { moduleList } from '../data/modules';

function normalizeRoles(user) {
  const userRoles = user?.roles;

  if (Array.isArray(userRoles)) {
    return userRoles
      .map((role) => String(role || '').trim())
      .filter(Boolean);
  }

  if (typeof userRoles === 'string') {
    return userRoles
      .split(',')
      .map((role) => role.trim())
      .filter(Boolean);
  }

  return [];
}

function roleLabel(role = '') {
  return String(role || '')
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
      'projects',
      'states',
    ].includes(key)
  ) {
    return 'Employee Setup';
  }

  if (
    [
      'attendance',
      'attendance_logs',
      'attendance_mode_requests',
      'holiday_calendar',
      'compoff_credits',
      'leave_requests',
      'leave_balances',
      'leave_types',
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
    'Attendance & Leave': 3,
    Reports: 4,
    'Payroll & Finance': 5,
    'Talent & Performance': 6,
    'Support & Records': 7,
    Account: 8,
    Modules: 99,
  };

  return order[group] || 99;
}

export default function AppLayout({ user, setUser, page, setPage, children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const safeUser = {
    ...(user || {}),
    roles: normalizeRoles(user),
  };

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

  const attendanceCount = modules.filter(([key]) =>
    [
      'attendance',
      'attendance_logs',
      'attendance_mode_requests',
      'holiday_calendar',
      'compoff_credits',
    ].includes(key),
  ).length;

  const leaveCount = modules.filter(([key]) =>
    ['leave_requests', 'leave_balances', 'leave_types'].includes(key),
  ).length;

  const reportsCount = modules.filter(([key]) => key === 'reports').length;

  function goTo(nextPage) {
    if (typeof setPage === 'function') {
      setPage(nextPage || 'dashboard');
    }

    setSidebarOpen(false);
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
  }

  return (
    <div className="app-shell">
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
            <small>Attendance • Leave • Payroll</small>
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

        <div className="sidebar-summary">
          <div>
            <Clock size={16} />
            <span>{attendanceCount} Attendance Modules</span>
          </div>

          <div>
            <CalendarDays size={16} />
            <span>{leaveCount} Leave Modules</span>
          </div>

          {reportsCount > 0 && (
            <div>
              <BarChart3 size={16} />
              <span>{reportsCount} Reports Module</span>
            </div>
          )}
        </div>

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
              {safeUser.roles.length
                ? safeUser.roles.map(roleLabel).join(', ')
                : 'User'}
              {safeUser?.tenant_id ? ` • ${safeUser.tenant_id}` : ''}
            </p>
          </div>

          <div className="user-chip">
            <User size={16} />
            <span>{safeUser?.name || safeUser?.email || 'User'}</span>
          </div>
        </header>

        {children}
      </main>
    </div>
  );
}