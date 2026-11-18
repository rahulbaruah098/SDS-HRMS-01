import { api } from './client';

export function faceRequest(path, data) {
  return api(
    `/face-attendance/${path}`,
    data === undefined
      ? {}
      : {
          method: 'POST',
          body: JSON.stringify(data),
          timeoutMs: 45000,
        },
  );
}

// Tenant-scoped HR/Admin settings. This is never taken from a client-supplied tenant ID.
export function getFaceAttendanceSettings() {
  return api('/face-attendance/settings');
}

export function updateFaceAttendanceSettings(mode, revision, confirmEnforcement = false) {
  return api('/face-attendance/settings', {
    method: 'PATCH',
    body: JSON.stringify({
      mode,
      revision,
      confirm_enforcement: confirmEnforcement,
    }),
  });
}
