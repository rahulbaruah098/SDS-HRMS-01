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