import { useEffect, useMemo, useRef, useState } from 'react';
import { X, CalendarDays, ClipboardList, Target, CheckCircle2 } from 'lucide-react';
import { api } from '../api/client';
import { monthCalendar, tenantHolidayMap } from '../utils/sprintWorkingCalendar.mjs';
import './sprint-monthly-plan-modal.css';

const monthValid = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ''));
const dateValid = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const labelMonth = month => monthValid(month)
  ? new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1))
  : month || 'Monthly plan';
const niceDate = value => {
  if (!dateValid(value)) return value;
  const [y,m,d] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(y,m-1,d));
};
const planRows = plan => Array.isArray(plan?.sheet_rows) && plan.sheet_rows.length
  ? plan.sheet_rows : (Array.isArray(plan?.goals) ? plan.goals : []).map(goal => ({ activity: typeof goal === 'string' ? goal : String(goal?.activity || goal?.title || '') }));

/** Read-only view of backend-provided monthly plan snapshots; never alters approvals. */
export default function SprintMonthlyPlanModal({ plan, month, employeeName, onClose }) {
  const closeRef = useRef(null);
  const selectedMonth = month || plan?.month || '';
  const rows = useMemo(() => planRows(plan), [plan]);
  const [holidayState, setHolidayState] = useState({ key: '', status: 'loading', holidays: {}, message: '' });
  const [selected, setSelected] = useState(() => {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    return today.startsWith(`${selectedMonth}-`) ? today : `${selectedMonth}-01`;
  });
  useEffect(() => {
    if (!plan) return;
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    setSelected(today.startsWith(`${selectedMonth}-`) ? today : `${selectedMonth}-01`);
  }, [plan, selectedMonth]);
  useEffect(() => {
    if (!plan) return;
    const previous = document.activeElement;
    const onKeyDown = event => {
      if (event.key === 'Escape') { event.preventDefault(); onClose?.(); }
      if (event.key !== 'Tab') return;
      const root = closeRef.current?.closest('[role="dialog"]');
      const items = [...(root?.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex="0"]') || [])];
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    closeRef.current?.focus();
    return () => { document.removeEventListener('keydown', onKeyDown); previous?.focus?.(); };
  }, [plan, onClose]);
  useEffect(() => {
    if (!plan) return;
    let alive = true;
    if (!monthValid(selectedMonth)) {
      setHolidayState({ key: selectedMonth, status: 'error', holidays: {}, message: 'Invalid planning month' });
      return () => { alive = false; };
    }
    setHolidayState({ key: selectedMonth, status: 'loading', holidays: {}, message: '' });
    const [y, m] = selectedMonth.split('-').map(Number);
    const last = String(new Date(y, m, 0).getDate()).padStart(2, '0');
    api(`/attendance/holidays?date_from=${selectedMonth}-01&date_to=${selectedMonth}-${last}`)
      .then(data => {
        if (!alive) return;
        if (!data?.default_state) throw new Error('Employee state unavailable for tenant holiday filtering');
        setHolidayState({ key: selectedMonth, status: 'ready', holidays: tenantHolidayMap(data.items || [], data.default_state), message: '' });
      })
      .catch(error => {
        if (alive) setHolidayState({ key: selectedMonth, status: 'error', holidays: {}, message: error?.message || 'Holiday calendar unavailable' });
      });
    return () => { alive = false; };
  }, [plan, selectedMonth]);
  const calendar = useMemo(() => monthValid(selectedMonth)
    ? monthCalendar(selectedMonth, holidayState.key === selectedMonth && holidayState.status === 'ready' ? holidayState.holidays : {})
    : [], [selectedMonth, holidayState]);
  const tasks = useMemo(() => {
    const byDate = new Map();
    rows.forEach((row, rowIndex) => {
      (Array.isArray(row?.daily_targets) ? row.daily_targets : []).forEach(target => {
        const date = String(target?.date || target?.scheduled_date || '').slice(0, 10);
        if (!dateValid(date) || !date.startsWith(`${selectedMonth}-`)) return;
        const task = {
          title: String(target?.title || target?.task || target?.activity || '').trim(),
          target: String(target?.target || target?.daily_target || target?.measurable_target || '').trim(),
          objective: String(row?.objective || row?.activity || '').trim(),
          rowIndex,
        };
        byDate.set(date, [...(byDate.get(date) || []), task]);
      });
    });
    return byDate;
  }, [rows, selectedMonth]);
  if (!plan) return null;
  const day = calendar.find(item => item.date === selected);
  const selectedTasks = tasks.get(selected) || [];
  const count = [...tasks.values()].reduce((sum, v) => sum + v.length, 0);
  const startOffset = calendar.length ? (new Date(Number(selectedMonth.slice(0,4)), Number(selectedMonth.slice(5,7))-1, 1).getDay() + 6) % 7 : 0;
  const name = employeeName || plan?.employee_name || plan?.requester_name || 'Employee';
  return <div className="smpm-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose?.(); }}>
    <section role="dialog" aria-modal="true" aria-label={`${name} monthly plan`} className="smpm-dialog">
      <header className="smpm-header">
        <div className="smpm-header-title">
          <span className="smpm-kicker">MONTHLY WORK PLAN</span>
          <h2>{name}</h2>
          <p>{plan?.title || 'Monthly Planning Sheet'} · {labelMonth(selectedMonth)}</p>
        </div>
        <button ref={closeRef} type="button" aria-label="Close monthly plan" className="smpm-close" onClick={onClose}><X size={19}/></button>
      </header>
      <div className="smpm-body">
        <div className="smpm-summary">
          <div><ClipboardList size={17}/><strong>{rows.length}</strong><span>Monthly activities</span></div>
          <div><CalendarDays size={17}/><strong>{count}</strong><span>Scheduled tasks</span></div>
          <div><Target size={17}/><strong>{rows.reduce((sum, r) => sum + (Number(r?.weightage) || 0), 0)}%</strong><span>Planned weightage</span></div>
        </div>
        <section className="smpm-goals" aria-label="Monthly goals and KPIs">
          <h3>Monthly goals and KPIs</h3>
          {rows.length ? rows.map((row, idx) => <details key={row.row_id || row.key || idx} open={idx === 0}>
            <summary>{row?.objective || row?.activity || `Activity ${idx + 1}`} <span>{row?.weightage !== undefined ? `${row.weightage}%` : ''}</span></summary>
            <div className="smpm-goal-grid">
              <p><b>Planned activity</b>{row?.activity || '—'}</p>
              <p><b>Expected deliverable</b>{row?.deliverable || '—'}</p>
              <p><b>KPI / success criteria</b>{row?.kpi || '—'}</p>
              <p><b>Target</b>{row?.target_quantity || '—'} {row?.unit || ''}</p>
            </div>
          </details>) : <p className="smpm-muted" role="status">No monthly activities were included in this plan.</p>}
        </section>
        <section className="smpm-calendar-section" aria-label="Date-wise monthly plan">
          <div className="smpm-section-head"><h3>Date-wise tasks</h3><span>{labelMonth(selectedMonth)}</span></div>
          {holidayState.status !== 'ready' && <p className="smpm-warning" role={holidayState.status === 'error' ? 'alert' : 'status'}>
            {holidayState.status === 'error' ? `Tenant holidays could not be verified: ${holidayState.message}. Weekly offs remain visible.` : 'Loading tenant holiday calendar…'}
          </p>}
          <div className="smpm-calendar" role="group" aria-label="Select a day">
            {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(value => <span className="smpm-weekday" key={value}>{value}</span>)}
            {Array.from({ length: startOffset }, (_, i) => <span key={`empty-${i}`} aria-hidden="true"/>)}
            {calendar.map(item => <button key={item.date} type="button" aria-pressed={selected === item.date}
              aria-label={`${niceDate(item.date)}, ${item.label}, ${(tasks.get(item.date) || []).length} tasks`}
              className={`smpm-date${selected === item.date ? ' is-selected' : ''}${!item.working ? ' is-off' : ''}${tasks.has(item.date) ? ' has-tasks' : ''}`}
              onClick={() => setSelected(item.date)}>
              {Number(item.date.slice(-2))}<span className="smpm-dot"/>
            </button>)}
          </div>
          <div className="smpm-day-info">
            <div><strong>{niceDate(selected)}</strong><span>{day?.label || 'Selected date'}</span></div>
            <span>{selectedTasks.length} {selectedTasks.length === 1 ? 'task' : 'tasks'}</span>
          </div>
          {selectedTasks.length ? selectedTasks.map((task, index) => <article key={`${task.rowIndex}-${index}`} className="smpm-task">
            <CheckCircle2 size={17}/><div><strong>{task.title || 'Untitled task'}</strong><p><b>Daily target:</b> {task.target || 'No target entered'}</p><small>{task.objective || 'Monthly goal'}</small></div>
          </article>) : <div className="smpm-empty">{day && !day.working ? 'Weekly off or tenant holiday — no scheduled work.' : 'No tasks scheduled for this date.'}</div>}
          {day && !day.working && selectedTasks.length > 0 && <p className="smpm-warning">This plan contains tasks scheduled on a non-working day.</p>}
          {!count && <p role="status" className="smpm-warning">No day-wise tasks are present in the saved plan. Review before approving.</p>}
        </section>
        {!!plan?.approval_history?.length && <section className="smpm-history"><h3>Approval history</h3>{plan.approval_history.map((entry, index) => <p key={index}>{entry.action || 'Action'} · {entry.at ? new Date(entry.at).toLocaleString() : 'Date unavailable'}{entry.remarks ? ` · ${entry.remarks}` : ''}</p>)}</section>}
      </div>
      <footer className="smpm-footer"><span>Read-only plan preview. No changes are made here.</span><button type="button" onClick={onClose}>Close</button></footer>
    </section>
  </div>;
}
