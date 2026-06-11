import { currentUser, currentEmployee } from '../api/client';

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

export const EMPLOYEE_BASE_ROLES = [
  'employee',
];

export const EMPLOYEE_CAPABILITY_ROLES = [
  'manager',
  'ro',
  'team_leader',
  'reporting_officer',
];

export const TEAM_AUTHORITY_ROLES = [
  ...EMPLOYEE_CAPABILITY_ROLES,
];

export const ATTENDANCE_MANAGER_ROLES = [
  ...HR_ADMIN_ROLES,
  ...EMPLOYEE_CAPABILITY_ROLES,
];

export const ATTENDANCE_ALL_ROLES = [
  ...HR_ADMIN_ROLES,
  ...EMPLOYEE_CAPABILITY_ROLES,
  ...EMPLOYEE_BASE_ROLES,
];

export const LEAVE_MANAGER_ROLES = [
  ...HR_ADMIN_ROLES,
  ...EMPLOYEE_CAPABILITY_ROLES,
];

export const LEAVE_ALL_ROLES = [
  ...HR_ADMIN_ROLES,
  ...EMPLOYEE_CAPABILITY_ROLES,
  ...EMPLOYEE_BASE_ROLES,
];

export const ALL_SYSTEM_ROLES = [
  ...HR_ADMIN_ROLES,
  'finance',
  'accounts_finance',
  ...EMPLOYEE_CAPABILITY_ROLES,
  ...EMPLOYEE_BASE_ROLES,
];


function normalizeRoleValue(role = '') {
  return String(role || '')
    .trim()
    .toLowerCase()
    .replaceAll('-', '_')
    .replace(/\s+/g, '_');
}

export function normalizeRoles(input) {
  const userRoles = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(',')
      : input?.roles;

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

  return [];
}

export function truthy(value) {
  return ['true', 'yes', '1', 'on'].includes(String(value || '').trim().toLowerCase());
}

export function roles() {
  const user = currentUser();
  return normalizeRoles(user);
}

export function employeeProfile() {
  return currentEmployee();
}


export function employeeCapabilityRoles() {
  const employee = employeeProfile() || {};
  const capabilityRoles = [];

  if (
    truthy(employee?.is_team_leader) ||
    truthy(employee?.team_leader_capability) ||
    truthy(employee?.can_act_as_team_leader) ||
    truthy(employee?.capabilities?.team_leader) ||
    truthy(employee?.permissions?.team_leader)
  ) {
    capabilityRoles.push('team_leader');
  }

  if (
    truthy(employee?.is_reporting_officer) ||
    truthy(employee?.reporting_officer_capability) ||
    truthy(employee?.can_act_as_reporting_officer) ||
    truthy(employee?.capabilities?.reporting_officer) ||
    truthy(employee?.permissions?.reporting_officer)
  ) {
    capabilityRoles.push('reporting_officer');
  }

  const rawCapabilities = [
    employee?.role,
    employee?.employee_role,
    employee?.capability,
    employee?.capability_role,
    employee?.access_role,
    employee?.mapped_role,
    ...(Array.isArray(employee?.roles) ? employee.roles : []),
    ...(Array.isArray(employee?.capabilities) ? employee.capabilities : []),
    ...(Array.isArray(employee?.permissions) ? employee.permissions : []),
  ];

  rawCapabilities.forEach((item) => {
    const normalized = normalizeRoleValue(item);

    if (EMPLOYEE_CAPABILITY_ROLES.includes(normalized)) {
      capabilityRoles.push(normalized);
    }
  });

  return [...new Set(capabilityRoles)];
}

export function effectiveRoles() {
  return [...new Set([...roles(), ...employeeCapabilityRoles()])];
}

export function hasRole(role) {
  return effectiveRoles().includes(normalizeRoleValue(role));
}

export function hasAnyRole(allowedRoles = []) {
  const userRoles = effectiveRoles();

  return allowedRoles
    .map((role) => normalizeRoleValue(role))
    .some((role) => userRoles.includes(role));
}

export function hasAllRoles(requiredRoles = []) {
  const userRoles = effectiveRoles();

  return requiredRoles
    .map((role) => normalizeRoleValue(role))
    .every((role) => userRoles.includes(role));
}

export function hasCapabilityRole(role) {
  const normalized = normalizeRoleValue(role);

  return EMPLOYEE_CAPABILITY_ROLES.includes(normalized) && hasRole(normalized);
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

export function isEmployeeUser() {
  return hasAnyRole([...EMPLOYEE_BASE_ROLES, ...EMPLOYEE_CAPABILITY_ROLES]);
}

export function isEmployeePortalUser() {
  return isEmployeeUser() && !isAdminUser() && !isFinanceUser() && !isSuperAdmin();
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
  return isEmployeeUser();
}

export function canApproveAttendanceMode() {
  return hasAnyRole(ATTENDANCE_MANAGER_ROLES);
}

export function canRequestHolidayWork() {
  return isEmployeeUser();
}

export function canApproveHolidayWork() {
  return hasAnyRole(ATTENDANCE_MANAGER_ROLES);
}

export function canViewTeamFieldAttendance() {
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
  return isEmployeeUser();
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

/*
  Backward-compatible function name.
  Important correction:
  Team Leader / Reporting Officer are employee capabilities, not separate
  dashboard identities. So an employee with team_leader/reporting_officer
  capability should still be treated as an employee self-service dashboard user.
*/
export function isEmployeeOnly() {
  const userRoles = effectiveRoles();

  return (
    userRoles.some((role) =>
      [...EMPLOYEE_BASE_ROLES, ...EMPLOYEE_CAPABILITY_ROLES].includes(role)
    ) &&
    !userRoles.some((role) =>
      [
        'super_admin',
        'admin',
        'hr_admin',
        'hr_manager',
        'hr',
        'finance',
        'accounts_finance',
      ].includes(role)
    )
  );
}

export function isEmployeeSelfServiceUser() {
  return isEmployeeOnly();
}

export function employeeCapabilityLabel() {
  const labels = [];

  if (isTeamLeader()) {
    labels.push('Team Leader');
  }

  if (isReportingOfficer()) {
    labels.push('Reporting Officer');
  }

  return labels.length ? labels.join(' + ') : '';
}

export function roleLabel(role = '') {
  const normalized = String(role || '').trim();

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

export function currentRoleLabel() {
    const userRoles = effectiveRoles();

  if (!userRoles.length) {
    return 'User';
  }

  if (isSuperAdmin()) return 'Super Admin';
  if (hasRole('admin')) return 'Admin';
  if (hasRole('hr_admin')) return 'HR Admin';
  if (hasRole('hr_manager')) return 'HR Manager';
  if (hasRole('hr')) return 'HR';
  if (hasAnyRole(['finance', 'accounts_finance'])) return 'Finance';

  const capability = employeeCapabilityLabel();

  return capability ? `Employee • ${capability}` : 'Employee';
}