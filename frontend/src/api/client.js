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
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });
  } catch {
    throw new Error('Unable to connect to backend server');
  }

  let data = {};

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (response.status === 401) {
    clearSession();
    throw new Error(data.message || 'Session expired. Please login again.');
  }

  if (!response.ok) {
    throw new Error(data.message || `API Error ${response.status}`);
  }

  return data;
}