import { currentUser } from '../api/client';

export function roles() {
  const user = currentUser();
  return Array.isArray(user?.roles) ? user.roles : [];
}

export function hasRole(role) {
  return roles().includes(role);
}

export function hasAnyRole(allowedRoles = []) {
  return allowedRoles.some((role) => roles().includes(role));
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