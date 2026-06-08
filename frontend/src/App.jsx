import React, { useEffect, useMemo, useState } from 'react';
import { currentUser, getTodayCelebrations } from './api/client';
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
import HolidayCalendar from './pages/HolidayCalendar';
import Employees from './pages/Employees';
import EmployeeDirectory from './pages/EmployeeDirectory';
import Assets from './pages/Assets.jsx';
import Departments from './pages/Departments';
import Designations from './pages/Designations';
import States from './pages/States';
import Profile from './pages/Profile';
import PasswordRequests from './pages/PasswordRequests';
import Reports from './pages/Reports';
import Leave from './pages/Leave';
import Projects from './pages/Projects';
import Policies from './pages/Policies.jsx';
import Notifications from './pages/Notifications';
import ApplicationStatus from './pages/ApplicationStatus';
import TeamApprovals from './pages/TeamApprovals';
import Performance from './pages/Performance';
import Grievance from './pages/Grievance';
import ITSupport from './pages/ITSupport';
import ManagementGroup from './pages/ManagementGroup';
import CelebrationPopup from './components/CelebrationPopup.jsx';


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

  employee_directory: 'employee_directory',
  employee_contact_directory: 'employee_directory',
  employee_contacts: 'employee_directory',
  staff_directory: 'employee_directory',
  staff_contacts: 'employee_directory',
  directory: 'employee_directory',

  department: 'departments',
  departments: 'departments',
  department_master: 'departments',
  designation: 'designations',
  designations: 'designations',
  designation_master: 'designations',
  state: 'states',
  states: 'states',
  state_master: 'states',

  user: 'users',
  users: 'users',
  user_control: 'users',
  user_management: 'users',
  superadmin_user_control: 'users',
  super_admin_user_control: 'users',
  tenant_user_control: 'users',
  tenant_users: 'users',
  tenant_employee_control: 'users',
  tenant_employees: 'users',

  leave: 'leave',
  leave_management: 'leave',

  apply_leave: 'leave_requests',
  leave_apply: 'leave_requests',
  leave_request: 'leave_requests',
  leave_requests: 'leave_requests',
  my_leave: 'leave_requests',
  my_leaves: 'leave_requests',

  leave_deductions: 'reports',
  leave_records: 'reports',

  leave_approval: 'team_approvals',
  leave_approvals: 'team_approvals',
  team_approval: 'team_approvals',
  team_approvals: 'team_approvals',
  team_leave_approval: 'team_approvals',
  team_leave_approvals: 'team_approvals',
  leave_approval_inbox: 'team_approvals',
  approval_inbox: 'team_approvals',
  pending_approvals: 'team_approvals',
  pending_leave_approvals: 'team_approvals',
  tl_approvals: 'team_approvals',
  team_leader_approvals: 'team_approvals',
  ro_approvals: 'team_approvals',
  reporting_officer_approvals: 'team_approvals',
  manager_approvals: 'team_approvals',

  'team-approvals': 'team_approvals',
  'team-approval': 'team_approvals',
  'leave-approval': 'team_approvals',
  'leave-approvals': 'team_approvals',
  'approval-inbox': 'team_approvals',
  'pending-approvals': 'team_approvals',
  'pending-leave-approvals': 'team_approvals',

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

  grievance: 'grievances',
  grievances: 'grievances',
  employee_grievance: 'grievances',
  employee_grievances: 'grievances',
  grievance_module: 'grievances',
  grievance_form: 'grievances',
  grievance_requests: 'grievances',
  anonymous_grievance: 'grievances',

  'employee-grievance': 'grievances',
  'employee-grievances': 'grievances',
  'grievance-module': 'grievances',
  'grievance-form': 'grievances',
  'anonymous-grievance': 'grievances',

  it_support: 'it_support',
  it_supports: 'it_support',
  it_ticket: 'it_support',
  it_tickets: 'it_support',
  support: 'it_support',
  support_ticket: 'it_support',
  support_tickets: 'it_support',
  technology_support: 'it_support',
  helpdesk: 'it_support',
  help_desk: 'it_support',

  'it-support': 'it_support',
  'it-ticket': 'it_support',
  'it-tickets': 'it_support',
  'support-ticket': 'it_support',
  'support-tickets': 'it_support',
  'technology-support': 'it_support',
  'help-desk': 'it_support',

  management_group: 'management_groups',
  management_groups: 'management_groups',
  management: 'management_groups',
  management_committee: 'management_groups',
  management_meetings: 'management_groups',
  meeting_minutes: 'management_groups',
  group_meetings: 'management_groups',

  'management-group': 'management_groups',
  'management-groups': 'management_groups',
  'management-committee': 'management_groups',
  'management-meetings': 'management_groups',
  'meeting-minutes': 'management_groups',
  'group-meetings': 'management_groups',


  asset: 'assets',
  assets: 'assets',
  asset_management: 'assets',
  hardware_assets: 'assets',
  software_assets: 'assets',

  'asset-management': 'assets',
  'hardware-assets': 'assets',
  'software-assets': 'assets',

  notification: 'notifications',
  notifications: 'notifications',

  password_request: 'password_requests',
  password_requests: 'password_requests',

  policy: 'policies',
  policies: 'policies',
  policy_module: 'policies',
  hr_policy: 'policies',
  hr_policies: 'policies',
  company_policy: 'policies',
  company_policies: 'policies',
  employee_policy: 'policies',
  employee_policies: 'policies',
  'policy-module': 'policies',
  'hr-policy': 'policies',
  'hr-policies': 'policies',
  'company-policy': 'policies',
  'company-policies': 'policies',
  'employee-policy': 'policies',
  'employee-policies': 'policies',

  project: 'projects',
  projects: 'projects',
  project_management: 'projects',
  project_progress: 'projects',
  project_analytics: 'projects',
  project_dashboard: 'projects',
  department_project_graph: 'projects',
  project_wise_graph: 'projects',
  team_project_graph: 'projects',
  project_team_tree: 'projects',
  project_tree: 'projects',
  team_tree: 'projects',
  team_hierarchy: 'projects',
  team_root_map: 'projects',
  root_map: 'projects',
  spider_map: 'projects',
  spider_tree: 'projects',
  collaborator_projects: 'projects',
  assigned_projects: 'projects',
  my_projects: 'projects',

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
  profile_photo: 'profile',
  avatar: 'profile',
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

function applyProfilePhotoAliases(payload = {}, photoValue = '') {
  const photo = String(photoValue || profilePhotoValue(payload) || '').trim();

  if (photo) {
    payload.avatar = photo;
    payload.profile_photo = photo;
    payload.profile_picture = photo;
    payload.photo = photo;
  }

  return payload;
}

function readStoredEmployee() {
  try {
    return JSON.parse(localStorage.getItem('sds_hrms_employee') || '{}');
  } catch {
    return {};
  }
}

function mergeUserWithEmployeeProfile(user = {}) {
  const storedEmployee = readStoredEmployee();
  const employee =
    user.employee ||
    user.employee_summary ||
    user.employee_profile ||
    storedEmployee ||
    {};

  const photo =
    profilePhotoValue(employee) ||
    profilePhotoValue(user);

  const mergedUser = {
    ...user,
    employee,
    employee_summary: user.employee_summary || employee,
    employee_profile: user.employee_profile || employee,
    roles: normalizeRoles(user),
  };

  applyProfilePhotoAliases(mergedUser, photo);

  if (mergedUser.employee && typeof mergedUser.employee === 'object') {
    applyProfilePhotoAliases(mergedUser.employee, photo);
  }

  if (mergedUser.employee_summary && typeof mergedUser.employee_summary === 'object') {
    applyProfilePhotoAliases(mergedUser.employee_summary, photo);
  }

  if (mergedUser.employee_profile && typeof mergedUser.employee_profile === 'object') {
    applyProfilePhotoAliases(mergedUser.employee_profile, photo);
  }

  return mergedUser;
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
  const safeUser = mergeUserWithEmployeeProfile(user || {});
  const normalizedPage = normalizePageKey(page);

  if (normalizedPage === 'dashboard') {
    return <DashboardRouter user={safeUser} setPage={setPage} />;
  }

  if (!canAccessModule(safeUser, normalizedPage)) {
    return <UnauthorizedPage setPage={setPage} />;
  }

  if (normalizedPage === 'attendance') {
    return <Attendance setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'companies') {
    return <Companies setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'users') {
    return <UserControl setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'employees') {
    return <Employees setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'assets') {
    return <Assets setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'employee_directory') {
    return <EmployeeDirectory setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'departments') {
    return <Departments setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'designations') {
    return <Designations setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'states') {
    return <States setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'projects') {
    return <Projects setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'policies') {
    return <Policies user={safeUser} setPage={setPage} />;
  }

  if (normalizedPage === 'team_approvals') {
    return <TeamApprovals setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'performance_reviews') {
    return <Performance setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'grievances') {
    return <Grievance setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'it_support') {
    return <ITSupport setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'management_groups') {
    return <ManagementGroup setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'profile') {
    return <Profile setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'password_requests') {
    return <PasswordRequests setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'leave') {
    return <Leave setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'reports') {
    return <Reports setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'notifications') {
    return <Notifications setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'application_status') {
    return <ApplicationStatus setPage={setPage} user={safeUser} />;
  }

  if (normalizedPage === 'holiday_calendar') {
    return <HolidayCalendar setPage={setPage} user={safeUser} />;
  }

  return <ModuleCrud collection={normalizedPage} setPage={setPage} user={safeUser} />;
}

export default function App() {
  const savedUser = currentUser();
  const savedEmployee = readStoredEmployee();

  const initialUser = savedUser?.email
    ? mergeUserWithEmployeeProfile({
        ...savedUser,
        employee: savedEmployee,
        employee_summary: savedEmployee,
      })
    : null;

  const [user, setUser] = useState(initialUser);
  const [page, setPage] = useState('dashboard');
  const [celebrations, setCelebrations] = useState([]);

  const normalizedUser = useMemo(() => {
    if (!user) {
      return null;
    }

    return mergeUserWithEmployeeProfile(user);
  }, [user]);

  const normalizedPage = useMemo(() => normalizePageKey(page), [page]);

  function handleSetUser(nextUser) {
    if (!nextUser) {
      setUser(null);
      setPage('dashboard');
      setCelebrations([]);
      return;
    }

    const nextEmployee =
      nextUser.employee ||
      nextUser.employee_summary ||
      nextUser.employee_profile ||
      readStoredEmployee();

    setUser(
      mergeUserWithEmployeeProfile({
        ...nextUser,
        employee: nextEmployee,
        employee_summary: nextEmployee,
      }),
    );

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

  useEffect(() => {
    if (!normalizedUser) {
      setCelebrations([]);
      return;
    }

    let cancelled = false;

    async function loadCelebrations() {
      try {
        const data = await getTodayCelebrations();

        if (!cancelled) {
          setCelebrations(data.released ? data.items || [] : []);
        }
      } catch {
        if (!cancelled) {
          setCelebrations([]);
        }
      }
    }

    loadCelebrations();

    return () => {
      cancelled = true;
    };
  }, [normalizedUser]);

  if (!normalizedUser) {
    return <Login onLogin={handleSetUser} />;
  }

  return (
    <>
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

      <CelebrationPopup celebrations={celebrations} />
    </>
  );
}