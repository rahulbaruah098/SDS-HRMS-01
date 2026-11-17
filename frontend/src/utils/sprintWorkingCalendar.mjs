// Calendar logic shared by Monthly Planning editor and the saved-sheet view.
// Tenant holiday records are fetched through the existing authenticated attendance API.
export const dateKey = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : '';
export function parseLocalDate(key) {
  if (!dateKey(key)) return null;
  const [year, month, day] = key.split('-').map(Number);
  const d = new Date(year, month - 1, day, 12, 0, 0);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day ? d : null;
}
export function toKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function followingDay(key) {
  const date = parseLocalDate(key);
  if (!date) return '';
  date.setDate(date.getDate() + 1);
  return toKey(date);
}
export function tenantHolidayMap(items = [], selectedState = '') {
  const map = {};
  const state = String(selectedState || '').trim().toLowerCase();
  for (const item of (Array.isArray(items) ? items : [])) {
    if (String(item.status || 'active').toLowerCase() === 'inactive' || item.is_deleted === true) continue;
    if (state && String(item.state || '').trim().toLowerCase() !== state) continue;
    const start = String(item.start_date || item.from_date || item.date || '').slice(0,10);
    const end = String(item.end_date || item.to_date || start).slice(0,10);
    if (!parseLocalDate(start) || !parseLocalDate(end) || end < start) continue;
    let cursor = start;
    for (let n=0; cursor <= end && n < 370; n++) {
      map[cursor] = String(item.title || 'Declared holiday');
      cursor = followingDay(cursor);
    }
  }
  return map;
}
export function dayType(key, holidayMap = {}) {
  const d = parseLocalDate(key);
  if (!d) return {working:false, label:'Invalid date', type:'invalid'};
  if (holidayMap[key]) return {working:false, label:holidayMap[key], type:'holiday'};
  if (d.getDay() === 0) return {working:false, label:'Sunday weekly off', type:'sunday'};
  const satOrdinal = Math.floor((d.getDate() - 1)/7) + 1;
  if (d.getDay() === 6 && (satOrdinal === 2 || satOrdinal === 4)) {
    return {working:false, label:`${satOrdinal === 2 ? 'Second' : 'Fourth'} Saturday weekly off`, type:'saturday'};
  }
  return {working:true, label:'Working day', type:'working'};
}
export function nextWorkingDate(after, holidayMap = {}, monthEnd = '') {
  let cursor = after;
  for (let i=0; i<370; i++) {
    cursor = followingDay(cursor);
    if (!cursor || (monthEnd && cursor > monthEnd)) return '';
    if (dayType(cursor, holidayMap).working) return cursor;
  }
  return '';
}
export function firstWorkingDate(start, end, holidayMap = {}) {
  if (!parseLocalDate(start) || !parseLocalDate(end) || start > end) return '';
  if (dayType(start, holidayMap).working) return start;
  return nextWorkingDate(start, holidayMap, end);
}
export function monthCalendar(month, holidayMap = {}) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) return [];
  const [y,m] = month.split('-').map(Number);
  const last = new Date(y,m,0).getDate();
  return Array.from({length:last},(_,i) => {
    const key = `${month}-${String(i+1).padStart(2,'0')}`;
    return {date:key, ...dayType(key,holidayMap)};
  });
}
