import { useState } from 'react';
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

import './styles.css';

function DashboardRouter({ user }) {
  const userRoles = user.roles || [];

  if (userRoles.includes('super_admin')) {
    return <SuperAdminDashboard />;
  }

  if (isEmployeeOnly()) {
    return <EmployeeDashboard />;
  }

  return <AdminDashboard />;
}

function UnauthorizedPage() {
  return (
    <section className="panel">
      <h2>Access Restricted</h2>
      <p>You do not have permission to access this module.</p>
      <p>Please contact Super Admin or HR Admin if this access is required.</p>
    </section>
  );
}

function PageRouter({ page, user }) {
  if (page === 'dashboard') {
    return <DashboardRouter user={user} />;
  }

  if (!canAccessModule(user, page)) {
    return <UnauthorizedPage />;
  }

  if (page === 'attendance') {
    return <Attendance />;
  }

  if (page === 'companies') {
    return <Companies />;
  }

  if (page === 'users') {
    return <UserControl />;
  }

  if (page === 'profile') {
  return <Profile />;
}

if (page === 'password_requests') {
  return <PasswordRequests />;
}


  return <ModuleCrud collection={page} />;
}

export default function App() {
  const [user, setUser] = useState(currentUser().email ? currentUser() : null);
  const [page, setPage] = useState('dashboard');

  if (!user) {
    return <Login onLogin={setUser} />;
  }

  return (
    <AppLayout user={user} setUser={setUser} page={page} setPage={setPage}>
      <PageRouter page={page} user={user} />
    </AppLayout>
  );
}