import { useEffect, useMemo, useState } from 'react';
import { currentUser } from './api/client';
import { canAccessModule } from './data/modules';

import AppLayout from './layouts/AppLayout';
import Login from './pages/Login';
import SuperAdminDashboard from './pages/SuperAdminDashboard';
import AdminDashboard from './pages/AdminDashboard';
import EmployeeDashboard from './pages/EmployeeDashboard';
import Attendance from './pages/Attendance';
import Companies from './pages/Companies';
import UserControl from './pages/UserControl';
import ModuleCrud from './pages/ModuleCrud';
import Profile from './pages/Profile';
import PasswordRequests from './pages/PasswordRequests';
import Reports from './pages/Reports';
import Projects from './pages/Projects';
import ApplicationStatus from './pages/ApplicationStatus';

import './styles.css';

const ADMIN_DASHBOARD_ROLES = [
  'admin',
  'hr_admin',
  'hr_manager',
  'hr',
  'finance',
  'accounts_finance',
];

const EMPLOYEE_CAPABILITY_ROLES = [
  'employee',
  'manager',
  'ro',
  'team_leader',
  'reporting_officer',
];

const PAGE_ALIASES = {
  home: 'dashboard',
  dashboard_home: 'dashboard',

  employee: 'employees',
  employees: 'employees',
  employee_master: 'employees',
  employee_management: 'employees',
  staff_master: 'employees',
  staff_management: 'employees',

  user: 'users',
  users: 'users',
  user_control: 'users',
  user_management: 'users',
  superadmin_user_control: 'users',
  super_admin_user_control: 'users',

  leave: 'leave_requests',
  leave_request: 'leave_requests',
  leave_requests: 'leave_requests',
  leave_management: 'leave_requests',
  leave_approvals: 'leave_requests',
  leave_deductions: 'reports',
  leave_records: 'reports',

  leave_balance: 'leave_balances',
  leave_balances: 'leave_balances',

  attendance_mode_request: 'attendance_mode_requests',
  attendance_mode_requests: 'attendance_mode_requests',
  wfh_field_requests: 'attendance_mode_requests',

  application_status: 'application_status',
  application_statuses: 'application_status',
  application: 'application_status',
  application_status_page: 'application_status',
  applicationstatus: 'application_status',
  application_status_report: 'application_status',
  request_status: 'application_status',
  request_status_page: 'application_status',
  my_requests: 'application_status',
  my_request_status: 'application_status',
  my_applications: 'application_status',
  application_tracking: 'application_status',

  'application-status': 'application_status',
  'request-status': 'application_status',
  'my-requests': 'application_status',
  'my-applications': 'application_status',

  notification: 'notifications',
  notifications: 'notifications',

  password_request: 'password_requests',
  password_requests: 'password_requests',

  project: 'projects',
  projects: 'projects',
  project_management: 'projects',
  project_progress: 'projects',
  project_analytics: 'projects',
  project_dashboard: 'projects',
  department_project_graph: 'projects',
  project_wise_graph: 'projects',

  performance: 'performance_reviews',
  performance_review: 'performance_reviews',
  performance_reviews: 'performance_reviews',
  appraisal: 'performance_reviews',
  appraisals: 'performance_reviews',
  ratings: 'performance_reviews',
  team_performance: 'performance_reviews',
  team_leader_performance: 'performance_reviews',
  reporting_officer_performance: 'performance_reviews',

  report: 'reports',
  reports: 'reports',

  profile: 'profile',
  my_profile: 'profile',
};

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

function normalizePageKey(page) {
  const key = String(page || 'dashboard')
    .trim()
    .replaceAll('-', '_')
    .replaceAll(' ', '_');

  if (!key) {
    return 'dashboard';
  }

  return PAGE_ALIASES[key] || PAGE_ALIASES[key.toLowerCase()] || key;
}

function hasAnyRole(userRoles = [], allowedRoles = []) {
  const normalizedUserRoles = userRoles.map((role) => normalizeRoleValue(role));
  const normalizedAllowedRoles = allowedRoles.map((role) => normalizeRoleValue(role));

  return normalizedAllowedRoles.some((role) => normalizedUserRoles.includes(role));
}

function shouldUseEmployeeDashboard(userRoles = []) {
  if (userRoles.includes('super_admin')) {
    return false;
  }

  if (hasAnyRole(userRoles, ADMIN_DASHBOARD_ROLES)) {
    return false;
  }

  return hasAnyRole(userRoles, EMPLOYEE_CAPABILITY_ROLES);
}

function DashboardRouter({ user, setPage }) {
  const userRoles = normalizeRoles(user);

  if (userRoles.includes('super_admin')) {
    return <SuperAdminDashboard setPage={setPage} />;
  }

  /*
    Important:
    Team Leader / Reporting Officer are employee capabilities, not separate
    dashboard/login identities. So if a login has employee + team_leader or
    employee + reporting_officer, it must still open EmployeeDashboard.
  */
  if (shouldUseEmployeeDashboard(userRoles)) {
    return <EmployeeDashboard setPage={setPage} />;
  }

  return (
    <AdminDashboard
      user={{
        ...user,
        roles: userRoles,
      }}
      setPage={setPage}
    />
  );
}

function UnauthorizedPage({ setPage }) {
  return (
    <section className="panel">
      <h2>Access Restricted</h2>
      <p>You do not have permission to access this module.</p>
      <p>Please contact Super Admin or HR Admin if this access is required.</p>

      <button
        type="button"
        className="primary"
        onClick={() => setPage('dashboard')}
      >
        Back to Dashboard
      </button>
    </section>
  );
}

function PageRouter({ page, user, setPage }) {
  const safeUser = {
    ...(user || {}),
    roles: normalizeRoles(user),
  };

  const normalizedPage = normalizePageKey(page);

  if (normalizedPage === 'dashboard') {
    return <DashboardRouter user={safeUser} setPage={setPage} />;
  }

  if (!canAccessModule(safeUser, normalizedPage)) {
    return <UnauthorizedPage setPage={setPage} />;
  }

  if (normalizedPage === 'attendance') {
    return <Attendance setPage={setPage} />;
  }

  if (normalizedPage === 'companies') {
    return <Companies setPage={setPage} />;
  }

  if (normalizedPage === 'users') {
    return <UserControl setPage={setPage} />;
  }

  if (normalizedPage === 'projects') {
    return <Projects setPage={setPage} />;
  }

  if (normalizedPage === 'profile') {
    return <Profile setPage={setPage} />;
  }

  if (normalizedPage === 'password_requests') {
    return <PasswordRequests setPage={setPage} />;
  }

  if (normalizedPage === 'reports') {
    return <Reports setPage={setPage} />;
  }

  if (normalizedPage === 'application_status') {
    return <ApplicationStatus setPage={setPage} />;
  }

  return <ModuleCrud collection={normalizedPage} setPage={setPage} />;
}

export default function App() {
  const savedUser = currentUser();

  const [user, setUser] = useState(savedUser?.email ? savedUser : null);
  const [page, setPage] = useState('dashboard');

  const normalizedUser = useMemo(() => {
    if (!user) {
      return null;
    }

    return {
      ...user,
      roles: normalizeRoles(user),
    };
  }, [user]);

  const normalizedPage = useMemo(() => normalizePageKey(page), [page]);

  function handleSetUser(nextUser) {
    if (!nextUser) {
      setUser(null);
      setPage('dashboard');
      return;
    }

    setUser({
      ...nextUser,
      roles: normalizeRoles(nextUser),
    });

    setPage('dashboard');
  }

  function handleSetPage(nextPage) {
    setPage(normalizePageKey(nextPage));
  }

  useEffect(() => {
    if (!normalizedUser) {
      return;
    }

    if (page !== normalizedPage) {
      setPage(normalizedPage);
      return;
    }

    if (normalizedPage !== 'dashboard' && !canAccessModule(normalizedUser, normalizedPage)) {
      setPage('dashboard');
    }
  }, [page, normalizedPage, normalizedUser]);

  if (!normalizedUser) {
    return <Login onLogin={handleSetUser} />;
  }

  return (
    <AppLayout
      user={normalizedUser}
      setUser={handleSetUser}
      page={normalizedPage}
      setPage={handleSetPage}
    >
      <PageRouter
        page={normalizedPage}
        user={normalizedUser}
        setPage={handleSetPage}
      />
    </AppLayout>
  );
}