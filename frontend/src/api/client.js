const API_BASE =
  import.meta.env.VITE_API_BASE || 'http://127.0.0.1:5000/api/v1';

export function getToken() {
  return localStorage.getItem('sds_hrms_token');
}

export function setSession(data = {}) {
  if (data.token) {
    localStorage.setItem('sds_hrms_token', data.token);
  }

  localStorage.setItem('sds_hrms_user', JSON.stringify(data.user || {}));
  localStorage.setItem('sds_hrms_employee', JSON.stringify(data.employee || {}));
}

export function clearSession() {
  localStorage.removeItem('sds_hrms_token');
  localStorage.removeItem('sds_hrms_user');
  localStorage.removeItem('sds_hrms_employee');
}

export function currentUser() {
  try {
    return JSON.parse(localStorage.getItem('sds_hrms_user') || '{}');
  } catch {
    return {};
  }
}

export function currentEmployee() {
  try {
    return JSON.parse(localStorage.getItem('sds_hrms_employee') || '{}');
  } catch {
    return {};
  }
}

function buildUrl(path = '') {
  const cleanBase = String(API_BASE).replace(/\/+$/, '');
  const cleanPath = String(path).startsWith('/') ? path : `/${path}`;

  return `${cleanBase}${cleanPath}`;
}

function buildQuery(params = {}) {
  const query = new URLSearchParams();

  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }

    query.append(key, value);
  });

  const queryString = query.toString();

  return queryString ? `?${queryString}` : '';
}

async function parseResponse(response) {
  const contentType = response.headers.get('content-type') || '';

  if (response.status === 204) {
    return {};
  }

  if (contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  try {
    const text = await response.text();
    return text ? { message: text } : {};
  } catch {
    return {};
  }
}

export async function api(path, options = {}) {
  const token = getToken();
  const isFormData = options.body instanceof FormData;

  const headers = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;

  try {
    response = await fetch(buildUrl(path), {
      ...options,
      headers,
    });
  } catch {
    throw new Error('Unable to connect to backend server');
  }

  const data = await parseResponse(response);

  if (response.status === 401) {
    clearSession();
    throw new Error(data.message || 'Session expired. Please login again.');
  }

  if (response.status === 403) {
    throw new Error(data.message || 'You do not have permission to perform this action.');
  }

  if (!response.ok) {
    throw new Error(data.message || `API Error ${response.status}`);
  }

  return data;
}

export function getApiBase() {
  return API_BASE;
}

/* -------------------------------------------------------------------------- */
/* Generic CRUD APIs                                                          */
/* -------------------------------------------------------------------------- */

export function listCollection(collection, params = {}) {
  return api(`/${collection}${buildQuery(params)}`);
}

export function createCollectionItem(collection, payload = {}) {
  return api(`/${collection}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateCollectionItem(collection, itemId, payload = {}) {
  return api(`/${collection}/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteCollectionItem(collection, itemId) {
  return api(`/${collection}/${itemId}`, {
    method: 'DELETE',
  });
}

/* -------------------------------------------------------------------------- */
/* Dashboard APIs                                                             */
/* -------------------------------------------------------------------------- */

export function getSuperAdminDashboard() {
  return api('/dashboard/superadmin');
}

export function getAdminDashboard() {
  return api('/dashboard/admin');
}

export function getEmployeeDashboard() {
  return api('/dashboard/employee');
}

/* -------------------------------------------------------------------------- */
/* Attendance APIs                                                            */
/* -------------------------------------------------------------------------- */

export function getAttendanceStatus() {
  return api('/attendance/status');
}

export function getMyAttendance() {
  return api('/attendance/my');
}

export function getAttendanceReport(params = {}) {
  return api(`/attendance/report${buildQuery(params)}`);
}

export function checkInAttendance(payload = {}) {
  return api('/attendance/check-in', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function checkOutAttendance(payload = {}) {
  return api('/attendance/check-out', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function verifyAttendance(attendanceId) {
  return api(`/attendance/${attendanceId}/verify`, {
    method: 'PATCH',
    body: JSON.stringify({ verified: true }),
  });
}

/* -------------------------------------------------------------------------- */
/* Attendance Mode Request APIs: WFH / Field                                  */
/* -------------------------------------------------------------------------- */

export function createAttendanceModeRequest(payload = {}) {
  return api('/attendance/mode-requests', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getMyAttendanceModeRequests() {
  return api('/attendance/my-mode-requests');
}

export function getAttendanceModeRequests(params = {}) {
  return api(`/attendance/mode-requests${buildQuery(params)}`);
}

export function decideAttendanceModeRequest(requestId, payload = {}) {
  return api(`/attendance/mode-requests/${requestId}/decision`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

/* -------------------------------------------------------------------------- */
/* Holiday Calendar APIs                                                      */
/* -------------------------------------------------------------------------- */

export function getHolidayCalendar(params = {}) {
  return api(`/attendance/holidays${buildQuery(params)}`);
}

export function createHoliday(payload = {}) {
  return api('/attendance/holidays', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateHoliday(holidayId, payload = {}) {
  return api(`/attendance/holidays/${holidayId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteHoliday(holidayId) {
  return api(`/attendance/holidays/${holidayId}`, {
    method: 'DELETE',
  });
}

/* -------------------------------------------------------------------------- */
/* Comp-Off APIs                                                              */
/* -------------------------------------------------------------------------- */

export function getMyCompOffs() {
  return api('/attendance/compoffs');
}

export function claimCompOff(compoffId, payload = {}) {
  return api(`/attendance/compoffs/${compoffId}/claim`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/* -------------------------------------------------------------------------- */
/* Leave Management APIs                                                      */
/* -------------------------------------------------------------------------- */

export function getLeaveBalances(params = {}) {
  return api(`/leave_balances${buildQuery(params)}`);
}

export function setLeaveBalance(employeeId, payload = {}) {
  return api(`/leave_balances/${employeeId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function applyLeaveRequest(payload = {}) {
  return api('/leave_requests/apply', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function decideLeaveRequest(requestId, payload = {}) {
  return api(`/leave_requests/${requestId}/decision`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function getLeaveRequests(params = {}) {
  return listCollection('leave_requests', params);
}

export function getHolidayRecords(params = {}) {
  return listCollection('holiday_calendar', params);
}

export function getAttendanceLogs(params = {}) {
  return listCollection('attendance_logs', params);
}

export function getCompOffCredits(params = {}) {
  return listCollection('compoff_credits', params);
}

/* -------------------------------------------------------------------------- */
/* Reports APIs                                                               */
/* -------------------------------------------------------------------------- */

export function getReportsSummary(params = {}) {
  return api(`/reports/summary${buildQuery(params)}`);
}

export function getAttendanceReports(params = {}) {
  return api(`/reports/attendance${buildQuery(params)}`);
}

export function getAttendanceModeReports(params = {}) {
  return api(`/reports/attendance-mode-requests${buildQuery(params)}`);
}

export function getHolidayReports(params = {}) {
  return api(`/reports/holidays${buildQuery(params)}`);
}

export function getCompOffReports(params = {}) {
  return api(`/reports/compoffs${buildQuery(params)}`);
}

export function getLeaveBalanceReports(params = {}) {
  return api(`/reports/leave-balances${buildQuery(params)}`);
}

export function getLeaveRequestReports(params = {}) {
  return api(`/reports/leave-requests${buildQuery(params)}`);
}

export function getAuditReports(params = {}) {
  return api(`/reports/audit${buildQuery(params)}`);
}

/* -------------------------------------------------------------------------- */
/* Super Admin APIs                                                           */
/* -------------------------------------------------------------------------- */

export function getCompanies(params = {}) {
  return api(`/superadmin/companies${buildQuery(params)}`);
}

export function createCompany(payload = {}) {
  return api('/superadmin/companies', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateCompany(tenantId, payload = {}) {
  return api(`/superadmin/companies/${tenantId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function getUsers(params = {}) {
  return api(`/superadmin/users${buildQuery(params)}`);
}

export function createUser(payload = {}) {
  return api('/superadmin/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateUser(userId, payload = {}) {
  return api(`/superadmin/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function resetUserPassword(userId, payload = {}) {
  return api(`/superadmin/users/${userId}/reset-password`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/* -------------------------------------------------------------------------- */
/* Password Request APIs                                                      */
/* -------------------------------------------------------------------------- */

export function createPasswordRequest(payload = {}) {
  return api('/password-requests', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getPasswordRequests(params = {}) {
  return api(`/password-requests${buildQuery(params)}`);
}

export function decidePasswordRequest(requestId, payload = {}) {
  return api(`/password-requests/${requestId}/decision`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

/* -------------------------------------------------------------------------- */
/* Location Helpers                                                           */
/* -------------------------------------------------------------------------- */

export function hasLocationInPayload(payload = {}) {
  return (
    payload.latitude !== undefined &&
    payload.latitude !== null &&
    payload.latitude !== '' &&
    payload.longitude !== undefined &&
    payload.longitude !== null &&
    payload.longitude !== ''
  );
}

export function getCurrentLocation(options = {}) {
  const geoOptions = {
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 0,
    ...options,
  };

  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Location access is not supported in this browser.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          address: '',
        });
      },
      (error) => {
        let message = 'Unable to fetch current location.';

        if (error.code === 1) {
          message = 'Location permission denied. Please allow location access.';
        }

        if (error.code === 2) {
          message = 'Location unavailable. Please check GPS or network.';
        }

        if (error.code === 3) {
          message = 'Location request timed out. Please try again.';
        }

        reject(new Error(message));
      },
      geoOptions,
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Attendance Payload Helpers                                                 */
/* -------------------------------------------------------------------------- */

export async function buildAttendancePayload(extraPayload = {}) {
  if (hasLocationInPayload(extraPayload)) {
    return extraPayload;
  }

  const location = await getCurrentLocation();

  return {
    ...extraPayload,
    latitude: location.latitude,
    longitude: location.longitude,
    accuracy: location.accuracy,
    address: location.address || '',
  };
}

export async function submitCheckIn(payload = {}) {
  const attendancePayload = await buildAttendancePayload(payload);
  return checkInAttendance(attendancePayload);
}

export async function submitCheckOut(payload = {}) {
  const attendancePayload = await buildAttendancePayload(payload);
  return checkOutAttendance(attendancePayload);
}