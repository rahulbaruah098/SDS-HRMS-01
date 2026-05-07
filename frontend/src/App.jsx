import { useEffect, useMemo, useState } from 'react';
import { currentUser } from './api/client';
import { isEmployeeOnly } from './utils/authHelpers';
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

import './styles.css';

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

function DashboardRouter({ user, setPage }) {
  const userRoles = normalizeRoles(user);

  if (userRoles.includes('super_admin')) {
    return <SuperAdminDashboard setPage={setPage} />;
  }

  if (isEmployeeOnly()) {
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

  if (page === 'dashboard') {
    return <DashboardRouter user={safeUser} setPage={setPage} />;
  }

  if (!canAccessModule(safeUser, page)) {
    return <UnauthorizedPage setPage={setPage} />;
  }

  if (page === 'attendance') {
    return <Attendance setPage={setPage} />;
  }

  if (page === 'companies') {
    return <Companies setPage={setPage} />;
  }

  if (page === 'users') {
    return <UserControl setPage={setPage} />;
  }

  if (page === 'profile') {
    return <Profile setPage={setPage} />;
  }

  if (page === 'password_requests') {
    return <PasswordRequests setPage={setPage} />;
  }

  if (page === 'reports') {
    return <Reports setPage={setPage} />;
  }

  return <ModuleCrud collection={page} setPage={setPage} />;
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
    if (!nextPage) {
      setPage('dashboard');
      return;
    }

    setPage(nextPage);
  }

  useEffect(() => {
    if (!normalizedUser) {
      return;
    }

    if (page !== 'dashboard' && !canAccessModule(normalizedUser, page)) {
      setPage('dashboard');
    }
  }, [page, normalizedUser]);

  if (!normalizedUser) {
    return <Login onLogin={handleSetUser} />;
  }

  return (
    <AppLayout
      user={normalizedUser}
      setUser={handleSetUser}
      page={page}
      setPage={handleSetPage}
    >
      <PageRouter
        page={page}
        user={normalizedUser}
        setPage={handleSetPage}
      />
    </AppLayout>
  );
}