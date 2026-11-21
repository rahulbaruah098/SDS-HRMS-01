/**
 * Device-local display of authoritative server UTC timestamps.
 * The device clock is NEVER the authoritative attendance/visit/audit clock.
 */
export function parseServerUtc(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  let text = String(value).trim();
  // Existing Flask/BSON serializers may emit naive UTC ISO strings. ISO without
  // Z/offset is otherwise interpreted by JS as local time, shifting the event.
  if (/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:\.\d+)?$/.test(text)) {
    text = `${text.replace(' ', 'T')}Z`;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatServerUtcForDevice(value) {
  if (!value) return '—';
  const date = parseServerUtc(value);
  if (!date) return String(value);
  return new Intl.DateTimeFormat(undefined, {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
    timeZoneName: 'short',
  }).format(date);
}

export function deviceTimeContext() {
  const now = new Date();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return {
    device_timezone: timezone,
    device_reported_at: now.toISOString(),
    device_utc_offset_minutes: -now.getTimezoneOffset(),
  };
}
