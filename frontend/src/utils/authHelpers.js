import { currentUser } from '../api/client';

export const SUPER_ADMIN_ROLES = [
  'super_admin',
];

export const HR_ADMIN_ROLES = [
  'super_admin',
  'admin',
  'hr_admin',
  'hr_manager',
  'hr',
];

export const FINANCE_ROLES = [
  'super_admin',
  'admin',
  'finance',
  'accounts_finance',
];

export const TEAM_AUTHORITY_ROLES = [
  'manager',
  'ro',
  'team_leader',
  'reporting_officer',
];

export const ATTENDANCE_MANAGER_ROLES = [
  'super_admin',
  'admin',
  'hr_admin',
  'hr_manager',
  'hr',
  'manager',
  'ro',
  'team_leader',
  'reporting_officer',
];

export const ATTENDANCE_ALL_ROLES = [
  'super_admin',
  'admin',
  'hr_admin',
  'hr_manager',
  'hr',
  'manager',
  'ro',
  'team_leader',
  'reporting_officer',
  'employee',
];

export const LEAVE_MANAGER_ROLES = [
  'super_admin',
  'admin',
  'hr_admin',
  'hr_manager',
  'hr',
  'manager',
  'ro',
  'team_leader',
  'reporting_officer',
];

export const LEAVE_ALL_ROLES = [
  'super_admin',
  'admin',
  'hr_admin',
  'hr_manager',
  'hr',
  'manager',
  'ro',
  'team_leader',
  'reporting_officer',
  'employee',
];

export const ALL_SYSTEM_ROLES = [
  'super_admin',
  'admin',
  'hr_admin',
  'hr_manager',
  'hr',
  'finance',
  'accounts_finance',
  'manager',
  'ro',
  'team_leader',
  'reporting_officer',
  'employee',
];

export function normalizeRoles(input) {
  const userRoles = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(',')
      : input?.roles;

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

export function roles() {
  const user = currentUser();
  return normalizeRoles(user);
}

export function hasRole(role) {
  return roles().includes(role);
}

export function hasAnyRole(allowedRoles = []) {
  const userRoles = roles();
  return allowedRoles.some((role) => userRoles.includes(role));
}

export function hasAllRoles(requiredRoles = []) {
  const userRoles = roles();
  return requiredRoles.every((role) => userRoles.includes(role));
}

export function isSuperAdmin() {
  return hasRole('super_admin');
}

export function isAdminUser() {
  return hasAnyRole(HR_ADMIN_ROLES);
}

export function isHRUser() {
  return hasAnyRole(HR_ADMIN_ROLES);
}

export function isFinanceUser() {
  return hasAnyRole(FINANCE_ROLES);
}

export function isTeamAuthority() {
  return hasAnyRole(TEAM_AUTHORITY_ROLES);
}

export function isTeamLeader() {
  return hasRole('team_leader');
}

export function isReportingOfficer() {
  return hasAnyRole(['reporting_officer', 'manager', 'ro']);
}

export function canManageEmployees() {
  return hasAnyRole(HR_ADMIN_ROLES);
}

export function canManageMasters() {
  return hasAnyRole(HR_ADMIN_ROLES);
}

export function canManageDepartments() {
  return canManageMasters();
}

export function canManageDesignations() {
  return canManageMasters();
}

export function canManageUsers() {
  return hasRole('super_admin');
}

export function canResetPasswords() {
  return hasRole('super_admin');
}

export function canViewAttendance() {
  return hasAnyRole(ATTENDANCE_ALL_ROLES);
}

export function canManageAttendance() {
  return hasAnyRole(ATTENDANCE_MANAGER_ROLES);
}

export function canVerifyAttendance() {
  return hasAnyRole(ATTENDANCE_MANAGER_ROLES);
}

export function canRequestAttendanceMode() {
  return hasAnyRole([
    'employee',
    'team_leader',
    'reporting_officer',
    'manager',
    'ro',
  ]);
}

export function canApproveAttendanceMode() {
  return hasAnyRole(ATTENDANCE_MANAGER_ROLES);
}

export function canManageHolidayCalendar() {
  return hasAnyRole(HR_ADMIN_ROLES);
}

export function canViewHolidayCalendar() {
  return hasAnyRole(ATTENDANCE_ALL_ROLES);
}

export function canViewCompOff() {
  return hasAnyRole(ATTENDANCE_ALL_ROLES);
}

export function canManageCompOff() {
  return hasAnyRole(ATTENDANCE_MANAGER_ROLES);
}

export function canApplyLeave() {
  return hasAnyRole([
    'employee',
    'team_leader',
    'reporting_officer',
    'manager',
    'ro',
  ]);
}

export function canApproveLeave() {
  return hasAnyRole(LEAVE_MANAGER_ROLES);
}

export function canManageLeaveBalances() {
  return hasAnyRole(HR_ADMIN_ROLES);
}

export function canViewLeaveBalances() {
  return hasAnyRole(LEAVE_ALL_ROLES);
}

export function isEmployeeOnly() {
  const userRoles = roles();

  return (
    userRoles.includes('employee') &&
    !userRoles.some((role) =>
      [
        'super_admin',
        'admin',
        'hr_admin',
        'hr_manager',
        'hr',
        'finance',
        'accounts_finance',
        'manager',
        'ro',
        'team_leader',
        'reporting_officer',
      ].includes(role)
    )
  );
}

export function isEmployeeSelfServiceUser() {
  return hasAnyRole([
    'employee',
    'team_leader',
    'reporting_officer',
    'manager',
    'ro',
  ]);
}

export function roleLabel(role = '') {
  return String(role || '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function currentRoleLabel() {
  const userRoles = roles();

  if (!userRoles.length) {
    return 'User';
  }

  return userRoles.map(roleLabel).join(', ');
}