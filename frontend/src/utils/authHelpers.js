import { currentUser } from '../api/client';

export function roles() {
  const user = currentUser();
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

export function hasRole(role) {
  return roles().includes(role);
}

export function hasAnyRole(allowedRoles = []) {
  const userRoles = roles();
  return allowedRoles.some((role) => userRoles.includes(role));
}

export function isSuperAdmin() {
  return hasRole('super_admin');
}

export function isAdminUser() {
  return hasAnyRole([
    'super_admin',
    'admin',
    'hr_admin',
    'hr_manager',
    'hr',
  ]);
}

export function isHRUser() {
  return hasAnyRole([
    'super_admin',
    'admin',
    'hr_admin',
    'hr_manager',
    'hr',
  ]);
}

export function isFinanceUser() {
  return hasAnyRole([
    'super_admin',
    'admin',
    'finance',
    'accounts_finance',
  ]);
}

export function isTeamAuthority() {
  return hasAnyRole([
    'manager',
    'ro',
    'team_leader',
    'reporting_officer',
  ]);
}

export function canManageEmployees() {
  return hasAnyRole([
    'super_admin',
    'admin',
    'hr_admin',
    'hr_manager',
    'hr',
  ]);
}

export function canManageMasters() {
  return hasAnyRole([
    'super_admin',
    'admin',
    'hr_admin',
    'hr_manager',
    'hr',
  ]);
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