import { currentUser } from '../api/client';

export function roles() {
  return currentUser().roles || [];
}

export function isSuperAdmin() {
  return roles().includes('super_admin');
}

export function isEmployeeOnly() {
  const r = roles();
  return r.includes('employee') && r.length === 1;
}
