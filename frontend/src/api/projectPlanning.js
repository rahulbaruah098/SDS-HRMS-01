import { api } from './client';

export const query = (values = {}) => {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== '' && value != null) params.set(key, value);
  });
  return params.size ? `?${params}` : '';
};

export function planning(path, values, method = 'GET') {
  return api(`/projects/planning${path}${method === 'GET' ? query(values) : ''}`, {
    method,
    ...(method !== 'GET' ? { body: JSON.stringify(values || {}) } : {}),
  });
}

export function projectSave(values, id) {
  return api(`/projects${id ? `/${id}` : ''}`, { method: id ? 'PATCH' : 'POST', body: JSON.stringify(values) });
}

export async function exportPlanning(values) {
  const blob = await api(`/projects/planning/export${query(values)}`, { responseType: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `YourComate_${values.report || 'employee'}_Performance.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export const localDate = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

export const uid = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
