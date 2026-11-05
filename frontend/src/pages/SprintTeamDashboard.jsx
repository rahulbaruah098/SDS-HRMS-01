import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Users, TrendingUp, CheckCircle2, Clock3,
  AlertCircle, FileCheck2, RefreshCw, Search,
  ArrowLeft, BarChart3, CalendarDays, ShieldAlert, Activity, PieChart,
  Layers3, ListChecks, ArrowUpDown, Inbox
} from 'lucide-react';

import { getSprintTeamMetrics } from '../api/sprintPlanning';
import SprintPerformanceDashboard from './SprintPerformanceDashboard';

const currentMonth = () => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
};

const number = value => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

const rate = value => Math.min(100, Math.max(0, number(value)));

const unwrap = response => {
  const first = response?.data ?? response;
  return first?.employees ? first : first?.data ?? first;
};

const palette = {
  primary: '#635bdb',
  complete: '#16a34a',
  progress: '#f59e0b',
  incomplete: '#ef4444',
  muted: '#94a3b8'
};

function SummaryCard({ title, value, icon: Icon, color, subtitle }) {
  return (
    <div className="card" style={{
      padding: 18,
      borderRadius: 13,
      minWidth: 0,
      animation: 'sprintTeamEnter .35s ease both'
    }}>
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 38,
        height: 38,
        borderRadius: 11,
        background: `${color}18`,
        color
      }}>
        <Icon size={20} />
      </span>
      <div style={{ fontSize: 28, fontWeight: 750, marginTop: 11 }}>
        {value}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
      {subtitle && (
        <div style={{ color: 'var(--text-muted, #64748b)', fontSize: 12, marginTop: 4 }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}

function ProgressBar({ value, color = palette.complete }) {
  const percentage = rate(value);
  return (
    <div role="progressbar"
      aria-label="Completion rate"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percentage}
      style={{
        height: 11,
        borderRadius: 999,
        background: 'var(--surface-secondary, #e2e8f0)',
        overflow: 'hidden',
        minWidth: 80
      }}>
      <div className="sprint-team-bar"
        style={{
          height: '100%',
          width: `${percentage}%`,
          background: color,
          borderRadius: 999
        }} />
    </div>
  );
}

function RateRing({ label, value, available, color, detail }) {
  const percent = rate(value);
  return (
    <div className="sprint-team-ring-card card">
      <div className="sprint-team-ring" style={{ '--ring-color': color, '--ring-percent': available ? percent : 0 }}
        role="img" aria-label={`${label}: ${available ? `${percent.toFixed(1)} percent` : 'Not applicable'}`}>
        <div className="sprint-team-ring-inner">
          <strong>{available ? `${percent.toFixed(1)}%` : 'N/A'}</strong>
        </div>
      </div>
      <div>
        <strong className="sprint-team-ring-title">{label}</strong>
        <p className="sprint-team-ring-detail">{detail}</p>
      </div>
    </div>
  );
}

function DistributionBar({ label, value, total, color }) {
  const n = number(value);
  return (
    <div className="sprint-team-distribution-row">
      <div className="sprint-team-distribution-label"><span>{label}</span><strong>{n}</strong></div>
      <div className="sprint-team-track" role="img" aria-label={`${label}: ${n} of ${number(total)} activities`}>
        <span style={{ width: `${number(total) ? Math.min(100, n * 100 / number(total)) : 0}%`, background: color }} />
      </div>
    </div>
  );
}


// These plan states are returned by the tenant- and hierarchy-scoped team API.
const planStatuses = [
  { key: 'approved', label: 'Approved', color: '#15976a' },
  { key: 'pending_approval', label: 'Pending approval', color: '#d48d2e' },
  { key: 'draft', label: 'Draft', color: '#8590a4' },
  { key: 'rejected', label: 'Rejected', color: '#d65a65' },
  { key: 'other', label: 'Other', color: '#8a96b0' }
];

function PlanStatus({ title, counts, total }) {
  const n = number(total);
  const series = planStatuses.filter(item => number(counts?.[item.key]) > 0);
  return (
    <div className="sprint-team-plan-block">
      <div className="sprint-team-plan-heading"><strong>{title}</strong><span>{n} total</span></div>
      {n === 0 ? (
        <p className="sprint-team-plan-none">No {title.toLowerCase()} created for the selected month.</p>
      ) : (
        <>
          <div className="sprint-team-plan-track" role="img" aria-label={`${title}: ${series.map(item => `${number(counts?.[item.key])} ${item.label}`).join(', ')}`}>
            {series.map(item => <span key={item.key} title={`${item.label}: ${number(counts?.[item.key])}`}
              style={{ width: `${number(counts?.[item.key]) / n * 100}%`, background: item.color }} />)}
          </div>
          <div className="sprint-team-plan-legend">
            {series.map(item => <div key={item.key}>
              <span><i style={{ background: item.color }} />{item.label}</span>
              <strong>{number(counts?.[item.key])}</strong>
            </div>)}
          </div>
          {number(counts?.approved) === 0 && <p className="sprint-team-plan-none">No plans approved yet.</p>}
        </>
      )}
    </div>
  );
}

const prettyWeek = date => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return String(date || '');
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? date : new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'
  }).format(parsed);
};

function WeeklyTrend({ weeks }) {
  const points = Array.isArray(weeks) ? weeks : [];
  const [selected, setSelected] = useState('');
  const focused = points.find(item => item.week === selected) || points[points.length - 1];
  const maxValue = Math.max(1, ...points.map(item => number(item.planned)));
  return (
    <section className="card sprint-team-chart-card">
      <div className="sprint-team-panel-heading">
        <div><h3><BarChart3 size={19} aria-hidden="true" /> Weekly activity trend</h3>
          <p>Planned versus completed activities from approved weekly plans.</p></div>
      </div>
      {points.length === 0 ? (
        <div className="sprint-team-chart-empty"><CalendarDays size={25} aria-hidden="true" />
          <strong>No work scheduled</strong><span>Approved activities scheduled in this month will appear here by week.</span></div>
      ) : (
        <>
          <div className="sprint-team-week-chart" role="group" aria-label="Select a week to review planned and completed activities">
            {points.map(item => {
              const planned = number(item.planned);
              const completed = number(item.completed);
              return <button type="button" key={item.week} className="sprint-team-week"
                aria-pressed={focused?.week === item.week}
                title={`Week of ${item.week}: ${planned} planned, ${completed} completed`}
                onClick={() => setSelected(item.week)}>
                <span className="sprint-team-week-bars">
                  <span className="sprint-team-week-bar is-planned" style={{height: `${planned / maxValue * 100}%`}} />
                  <span className="sprint-team-week-bar is-completed" style={{height: `${completed / maxValue * 100}%`}} />
                </span>
                <span className="sprint-team-week-label">{item.week_label || item.week}</span>
              </button>;
            })}
          </div>
          <div className="sprint-team-week-legend"><span><i className="is-planned" /> Planned</span><span><i className="is-completed" /> Completed</span></div>
          {focused && <div className="sprint-team-week-detail" aria-live="polite">
            <strong>Week of {prettyWeek(focused.week)}</strong>
            <span>{number(focused.planned)} planned</span>
            <span>{number(focused.completed)} completed</span>
            <span>{number(focused.planned) > 0 ? `${rate(focused.completion_rate).toFixed(1)}% completion` : 'No planned work'}</span>
          </div>}
        </>
      )}
    </section>
  );
}

function PlanningPipeline({ pipeline }) {
  return (
    <section className="card sprint-team-chart-card">
      <div className="sprint-team-panel-heading">
        <div><h3><Layers3 size={19} aria-hidden="true" /> Plan approval status</h3>
          <p>Monthly and weekly plans across the authorised employee set.</p></div>
      </div>
      {!pipeline || typeof pipeline !== 'object' ? (
        <p className="sprint-team-plan-none">Planning status data is not available.</p>
      ) : (
        <>
          <PlanStatus title="Monthly plans" counts={pipeline.monthly} total={pipeline.monthly_total} />
          <PlanStatus title="Weekly plans" counts={pipeline.weekly} total={pipeline.weekly_total} />
          {pipeline.truncated === true && <p className="sprint-team-plan-warning" role="status">
            <ShieldAlert size={15} /> Plan counts are incomplete because the server result limit was reached.
          </p>}
        </>
      )}
    </section>
  );
}

export default function SprintTeamDashboard() {
  const [month, setMonth] = useState(currentMonth);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('all');
  const [sortBy, setSortBy] = useState('completion');
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const requestId = useRef(0);


  const load = useCallback(async () => {
    const current = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const response = await getSprintTeamMetrics({ month });
      const payload = unwrap(response);

      if (!payload || !Array.isArray(payload.employees) || !payload.summary) {
        throw new Error('Team performance response is incomplete.');
      }

      if (current === requestId.current) setResult(payload);
    } catch (err) {
      if (current === requestId.current) {
        setResult(null);
        setError(err?.message || 'Unable to retrieve team performance.');
      }
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    load();
    return () => { requestId.current += 1; };
  }, [load]);

  const employees = useMemo(() => (
    Array.isArray(result?.employees) ? result.employees : []
  ), [result]);

  const departments = useMemo(() => (
    [...new Set(
      employees.map(item => String(item.department || '').trim())
        .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b))
  ), [employees]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter(employee => {
      const matchesDepartment = department === 'all' ||
        employee.department === department;

      const searchable = [
        employee.name,
        employee.employee_code,
        employee.department
      ].join(' ').toLowerCase();

      return matchesDepartment && (!q || searchable.includes(q));
    }).sort((a, b) => {
      if (sortBy === 'name') return String(a.name || '').localeCompare(String(b.name || ''));
      if (sortBy === 'planned') return number(b.planned) - number(a.planned) || String(a.name || '').localeCompare(String(b.name || ''));
      if (sortBy === 'reporting') return (number(b.planned) ? rate(b.reporting_rate) : -1) - (number(a.planned) ? rate(a.reporting_rate) : -1) || String(a.name || '').localeCompare(String(b.name || ''));
      return (number(b.planned) ? rate(b.completion_rate) : -1) - (number(a.planned) ? rate(a.completion_rate) : -1) || String(a.name || '').localeCompare(String(b.name || ''));
    });
  }, [employees, search, department, sortBy]);

  const summary = result?.summary || {};
  const isTruncated = result?.truncated === true;
  const totalPlanned = number(summary.planned);
  const totalCompleted = number(summary.completed);
  const totalReported = totalPlanned - Math.min(totalPlanned, number(summary.unreported));

  const departmentStats = useMemo(() => {
    const map = new Map();

    for (const employee of employees) {
      const name = employee.department || 'Unassigned';
      const current = map.get(name) || {
        name, employees: 0, planned: 0, completed: 0
      };

      current.employees += 1;
      current.planned += number(employee.planned);
      current.completed += number(employee.completed);
      map.set(name, current);
    }

    return [...map.values()]
      .map(item => ({
        ...item,
        completion_rate: item.planned
          ? item.completed * 100 / item.planned
          : null
      }))
      .sort((a, b) => (b.completion_rate ?? -1) - (a.completion_rate ?? -1));
  }, [employees]);

  return (
    <main className="sprint-team-dashboard"
      style={{ maxWidth: 1450, minWidth: 0, margin: '0 auto', padding: 'clamp(12px,2vw,24px)', color: 'var(--text, inherit)' }}>
      <style>{`
        .sprint-team-dashboard { --sprint-primary: #635bdb; }
        .sprint-team-dashboard .card { box-shadow: 0 5px 24px rgba(46, 48, 94, .045); }
        .sprint-team-dashboard .sprint-team-stats > .card { border: 1px solid #e9e8f5; }
        .sprint-team-dashboard .sprint-team-ring-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr)); gap:14px; margin-bottom:18px; }
        .sprint-team-dashboard .sprint-team-ring-card { display:flex; align-items:center; gap:16px; padding:20px; border-radius:17px; min-width:0; }
        .sprint-team-dashboard .sprint-team-ring { width:108px; height:108px; flex:0 0 108px; display:grid; place-items:center; border-radius:50%; background:conic-gradient(var(--ring-color) calc(var(--ring-percent) * 1%),#eaeaf4 0); animation:sprintTeamRing .8s both; }
        .sprint-team-dashboard .sprint-team-ring-inner { width:86px; height:86px; background:var(--surface,white); border-radius:50%; display:grid; place-items:center; }
        .sprint-team-dashboard .sprint-team-ring-inner strong { font-size:20px; letter-spacing:-.6px; }
        .sprint-team-dashboard .sprint-team-ring-title { font-size:14px; }
        .sprint-team-dashboard .sprint-team-ring-detail { margin:5px 0 0; font-size:12px; line-height:1.5; color:var(--text-muted,#64748b); }
        .sprint-team-dashboard .sprint-team-distribution-row { margin-bottom:14px; }
        .sprint-team-dashboard .sprint-team-distribution-label { display:flex; justify-content:space-between; gap:12px; margin-bottom:7px; font-size:13px; }
        .sprint-team-dashboard .sprint-team-track { height:11px; overflow:hidden; border-radius:99px; background:#eceaf5; }
        .sprint-team-dashboard .sprint-team-track span { display:block; height:100%; border-radius:inherit; transition:width .75s ease; }
        .sprint-team-dashboard .sprint-team-dept-row { padding:12px 0; border-bottom:1px solid var(--border,#edf0f4); }
        .sprint-team-dashboard .sprint-team-dept-row:last-child { border-bottom:0; }
        .sprint-team-dashboard .sprint-team-deep-panels { display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:16px;margin-bottom:18px; }
        .sprint-team-dashboard .sprint-team-chart-card { min-width:0;padding:20px;border-radius:16px; }
        .sprint-team-dashboard .sprint-team-panel-heading h3 { margin:0 0 7px;display:flex;align-items:center;gap:9px;font-size:16px; }
        .sprint-team-dashboard .sprint-team-panel-heading p { margin:0 0 16px;color:var(--muted,#64748b);font-size:12px;line-height:1.6; }
        .sprint-team-dashboard .sprint-team-week-chart { height:185px;display:flex;align-items:stretch;justify-content:space-around;gap:10px;padding:12px 4px 0;border-bottom:1px solid var(--line,#e2e8f0);background:repeating-linear-gradient(to bottom,transparent 0,transparent calc(25% - 1px),var(--line,#e2e8f0) calc(25% - 1px),var(--line,#e2e8f0) 25%); }
        .sprint-team-dashboard .sprint-team-week { flex:1;max-width:108px;min-width:0;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;padding:5px 6px 0;border:1px solid transparent;border-bottom:0;border-radius:9px 9px 0 0;background:transparent;color:inherit;font:inherit;cursor:pointer; }
        .sprint-team-dashboard .sprint-team-week:hover,.sprint-team-dashboard .sprint-team-week[aria-pressed=true] { border-color:var(--line,#e2e8f0);background:var(--surface2,#f1f5f9); }
        .sprint-team-dashboard .sprint-team-week-bars { height:138px;width:100%;display:flex;align-items:flex-end;justify-content:center;gap:5px; }
        .sprint-team-dashboard .sprint-team-week-bar { width:min(38%,26px);max-height:100%;border-radius:5px 5px 0 0;transition:height .65s cubic-bezier(.16,1,.3,1); }
        .sprint-team-dashboard .sprint-team-week-bar.is-planned,.sprint-team-dashboard .sprint-team-week-legend i.is-planned { background:var(--primary,#4f46e5); }
        .sprint-team-dashboard .sprint-team-week-bar.is-completed,.sprint-team-dashboard .sprint-team-week-legend i.is-completed { background:var(--success,#059669); }
        .sprint-team-dashboard .sprint-team-week-label { margin:8px 0 6px;color:var(--muted,#64748b);font-size:11px;font-weight:700;white-space:nowrap; }
        .sprint-team-dashboard .sprint-team-week-legend { display:flex;gap:16px;align-items:center;margin:13px 0; }
        .sprint-team-dashboard .sprint-team-week-legend span { display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted,#64748b); }
        .sprint-team-dashboard .sprint-team-week-legend i,.sprint-team-dashboard .sprint-team-plan-legend i { display:inline-block;width:9px;height:9px;border-radius:3px;flex-shrink:0; }
        .sprint-team-dashboard .sprint-team-week-detail { display:flex;flex-wrap:wrap;gap:8px 13px;padding:12px;border-radius:10px;background:var(--surface2,#f1f5f9);font-size:12px;color:var(--muted,#64748b); }
        .sprint-team-dashboard .sprint-team-week-detail strong { color:var(--ink,#0f172a); }
        .sprint-team-dashboard .sprint-team-chart-empty { min-height:220px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:10px;color:var(--muted,#64748b); }
        .sprint-team-dashboard .sprint-team-chart-empty strong { color:var(--ink,#0f172a); }
        .sprint-team-dashboard .sprint-team-chart-empty span { max-width:290px;font-size:12px;line-height:1.6; }
        .sprint-team-dashboard .sprint-team-plan-block { padding:12px 0 16px; }
        .sprint-team-dashboard .sprint-team-plan-block+.sprint-team-plan-block { border-top:1px solid var(--line,#e2e8f0); }
        .sprint-team-dashboard .sprint-team-plan-heading { display:flex;justify-content:space-between;gap:10px;font-size:13px;margin-bottom:12px; }
        .sprint-team-dashboard .sprint-team-plan-heading span { color:var(--muted,#64748b);font-size:11px; }
        .sprint-team-dashboard .sprint-team-plan-track { display:flex;overflow:hidden;border-radius:99px;height:10px;background:var(--surface2,#f1f5f9); }
        .sprint-team-dashboard .sprint-team-plan-track span { display:block;height:100%;min-width:1px; }
        .sprint-team-dashboard .sprint-team-plan-legend { margin-top:11px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 13px; }
        .sprint-team-dashboard .sprint-team-plan-legend>div { display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:11px; }
        .sprint-team-dashboard .sprint-team-plan-legend>div span { display:inline-flex;align-items:center;gap:6px;min-width:0; }
        .sprint-team-dashboard .sprint-team-plan-none { font-size:12px;color:var(--muted,#64748b);line-height:1.6;margin:10px 0 0; }
        .sprint-team-dashboard .sprint-team-plan-warning { font-size:11px;color:var(--warning,#d97706);display:flex;align-items:flex-start;gap:7px;margin:10px 0 0; }
        .sprint-team-dashboard .sprint-team-notice { display:flex;align-items:flex-start;gap:10px;padding:15px 17px;margin-bottom:16px;border-radius:12px;border:1px dashed var(--line,#e2e8f0);background:var(--surface2,#f1f5f9);font-size:12px;line-height:1.6; }
        .sprint-team-dashboard .sprint-team-notice svg { flex-shrink:0;color:var(--primary,#4f46e5);margin-top:2px; }
        .sprint-team-dashboard .sprint-team-notice strong { display:block;font-size:13px;margin-bottom:3px; }
        .sprint-team-dashboard .sprint-team-loading { padding:22px;border-radius:16px; }
        .sprint-team-dashboard .sprint-team-loading span { display:block;width:44%;min-width:130px;height:13px;border-radius:7px;background:var(--surface2,#f1f5f9);animation:sprintTeamPulse 1.2s ease-in-out infinite alternate; }
        .sprint-team-dashboard .sprint-team-loading-grid { display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,155px),1fr));gap:12px;margin-top:19px; }
        .sprint-team-dashboard .sprint-team-loading-grid div { height:102px;border-radius:11px;background:var(--surface2,#f1f5f9);animation:sprintTeamPulse 1.2s ease-in-out infinite alternate; }
        @keyframes sprintTeamPulse { from { opacity:.52; } to {opacity:1;} }
        .sprint-team-dashboard .sprint-team-notice p { margin:0;color:var(--muted,#64748b); }
        @media(max-width:850px) { .sprint-team-dashboard .sprint-team-deep-panels { grid-template-columns:1fr; } }

        @keyframes sprintTeamRing { from { opacity:0; transform:scale(.93); } to { opacity:1; transform:scale(1); } }
        .sprint-team-dashboard .card { min-width: 0; background: var(--surface, var(--card-bg, #fff)); border-color: var(--border, #e2e8f0); }
        .sprint-team-dashboard .sprint-team-header { min-width: 0; }
        .sprint-team-dashboard .sprint-team-title { font-size: clamp(1.22rem, 2.5vw, 1.65rem); line-height: 1.25; }
        .sprint-team-dashboard .sprint-team-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 9px; min-width: 0; }
        .sprint-team-dashboard .btn.btn-secondary { display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:40px;padding:8px 14px;border:1px solid var(--border,#dce3ed);border-radius:10px;background:var(--surface,#fff);color:var(--ink,#14233e);font:inherit;font-size:12px;font-weight:650;line-height:1.3;cursor:pointer;transition:background .16s,border-color .16s,box-shadow .16s; }
        .sprint-team-dashboard .btn.btn-secondary:hover:not(:disabled) { background:var(--surface2,#f3f5ff);border-color:var(--primary,#635bdb);box-shadow:0 2px 8px rgba(53,49,110,.06); }
        .sprint-team-dashboard .btn.btn-secondary:disabled { opacity:.5;cursor:not-allowed; }
        .sprint-team-dashboard .sprint-team-control { min-height: 44px; max-width: 100%; }
        .sprint-team-dashboard button { min-height: 42px; }
        .sprint-team-dashboard button:focus-visible,
        .sprint-team-dashboard input:focus-visible,
        .sprint-team-dashboard select:focus-visible { outline: 2px solid var(--sprint-primary); outline-offset: 2px; }
        .sprint-team-dashboard .sprint-team-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 160px), 1fr)); gap: 12px; margin-bottom: 18px; }
        .sprint-team-dashboard .sprint-team-panels { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: 16px; margin-bottom: 18px; }
        .sprint-team-dashboard .sprint-team-filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr)); gap: 12px; margin-bottom: 12px; }
        .sprint-team-dashboard .sprint-team-employee { min-width: 0; overflow-wrap: anywhere; background: var(--surface, #fff); }
        .sprint-team-dashboard .sprint-team-employee-name { min-width: 0; }
        .sprint-team-dashboard .sprint-team-employee-actions { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
        .sprint-team-dashboard .sprint-team-employee-progress { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; }
        .sprint-team-dashboard .sprint-team-employee-meta { display: flex; flex-wrap: wrap; gap: 8px 14px; }
        @media (max-width: 600px) {
          .sprint-team-dashboard .sprint-team-controls { width: 100%; }
          .sprint-team-dashboard .sprint-team-controls .sprint-team-control { flex: 1 1 135px; }
          .sprint-team-dashboard .sprint-team-controls button { flex: 1 1 110px; justify-content: center; }
          .sprint-team-dashboard .sprint-team-employee-actions button { width: 100%; justify-content: center; }
          .sprint-team-dashboard .sprint-team-employee-meta { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); }
        }
        @media (max-width: 370px) {
          .sprint-team-dashboard .sprint-team-employee-meta { grid-template-columns: 1fr; }
        }
        @keyframes sprintTeamEnter {
          from { opacity: 0; transform: translateY(7px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .sprint-team-dashboard .sprint-team-bar {
          transition: width .8s ease;
        }
        @media (prefers-reduced-motion: reduce) {
          .sprint-team-dashboard * {
            transition: none !important;
            animation: none !important;
          }
        }
      `}</style>
      {selectedEmployee ? (
        <>
          <button type="button" className="btn btn-secondary"
            onClick={() => setSelectedEmployee(null)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 15 }}>
            <ArrowLeft size={16} /> Back to Team Performance
          </button>
          <div className="card" style={{ padding: 'clamp(14px, 2vw, 20px)', marginBottom: 15 }}>
            <strong>{selectedEmployee.name}</strong>
            <div style={{ fontSize: 13, color: 'var(--text-muted, #64748b)' }}>
              {selectedEmployee.employee_code} · {selectedEmployee.department || 'Department not assigned'}
            </div>
          </div>
          <SprintPerformanceDashboard
            key={`${selectedEmployee.employee_id}:${month}`}
            initialMonth={month}
            employeeId={selectedEmployee.employee_id}
          />
        </>
      ) : (
        <>
          <header className="sprint-team-header" style={{
            display: 'flex', justifyContent: 'space-between',
            alignItems: 'center', gap: 15, flexWrap: 'wrap',
            marginBottom: 22
          }}>
            <div>
              <h2 className="sprint-team-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <Users size={25} /> Team Sprint Performance
              </h2>
              <p style={{
                color: 'var(--text-muted, #64748b)',
                marginBottom: 0
              }}>
                Employee-wise planning progress and reporting performance
                within your authorised scope.
              </p>
            </div>
            <div className="sprint-team-controls">
              <CalendarDays size={17} />
              <input className="sprint-team-control" type="month" value={month}
                aria-label="Team performance month"
                onChange={event => setMonth(event.target.value)}
                style={{
                  padding: '9px 11px', borderRadius: 9,
                  border: '1px solid var(--border, #dbe1e8)',
                  background: 'var(--surface, #fff)', color: 'inherit'
                }} />
              <button type="button" className="btn btn-secondary"
                onClick={load} disabled={loading}>
                <RefreshCw size={16} /> Refresh
              </button>
            </div>
          </header>

          {loading && (
            <div className="card sprint-team-loading" role="status" aria-label="Loading team performance">
              <span />
              <div className="sprint-team-loading-grid" aria-hidden="true">
                {[0, 1, 2, 3].map(index => <div key={index} />)}
              </div>
              <p style={{ fontSize: 12, margin: '15px 0 0', color: 'var(--muted,#64748b)' }}>Loading authorised team metrics...</p>
            </div>
          )}

          {!loading && error && (
            <div className="card" role="alert" style={{ padding: 22 }}>
              <strong>Unable to load team data</strong>
              <p>{error}</p>
              <button type="button" className="btn btn-secondary" onClick={load}>
                Try Again
              </button>
            </div>
          )}

          {!loading && !error && result && (
            <>
              <div className="card" style={{ padding: 14, marginBottom: 16, fontSize: 13 }}>
                Viewing: <strong>{result.scope === 'organisation'
                  ? 'Organisation'
                  : 'Assigned Team'}</strong>
                {' '}· {employees.length} employee records
                {' '}· Approved weekly plans only
              </div>

              {isTruncated && (
                <div role="alert" className="card"
                  style={{
                    padding: 15, marginBottom: 16,
                    border: '1px solid #f59e0b'
                  }}>
                  <ShieldAlert size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />
                  Results are limited to the first {result.limit || 100} authorised
                  employees. Aggregates and department charts below are partial,
                  not complete organisation totals.
                </div>
              )}

              {employees.length === 0 && (
                <div className="sprint-team-notice" role="status"><Inbox size={21} />
                  <div><strong>{result.scope === 'organisation' ? 'No employee records available' : 'No team members assigned'}</strong>
                    <p>No employees were returned within your authorised reporting scope for this period.</p></div>
                </div>
              )}
              {employees.length > 0 && totalPlanned === 0 && (
                <div className="sprint-team-notice" role="status"><ListChecks size={21} />
                  <div><strong>No approved work scheduled this month</strong>
                    <p>{number(result?.planning_pipeline?.monthly_total) + number(result?.planning_pipeline?.weekly_total) > 0
                      ? 'Plans exist, but there are no activities in approved weekly plans for this month. Review the approval status below.'
                      : 'No monthly or weekly plans were found for these employees in this month. Rates are not applicable.'}</p></div>
                </div>
              )}
              {totalPlanned > 0 && totalReported === 0 && (
                <div className="sprint-team-notice" role="status"><FileCheck2 size={21} />
                  <div><strong>No daily activity reports recorded</strong>
                    <p>Approved work is scheduled, but none of its activities have a reported status yet.</p></div>
                </div>
              )}
              <div className="sprint-team-stats">
                <SummaryCard title="Employees" value={employees.length}
                  icon={Users} color={palette.primary} />
                <SummaryCard title="Planned Activities" value={number(summary.planned)}
                  icon={BarChart3} color={palette.primary} />
                <SummaryCard title="Completed" value={number(summary.completed)}
                  icon={CheckCircle2} color={palette.complete} />
                <SummaryCard title="In Progress" value={number(summary.in_progress)}
                  icon={Clock3} color={palette.progress} />
                <SummaryCard title="Not Completed" value={number(summary.not_completed)}
                  icon={AlertCircle} color={palette.incomplete} />
                <SummaryCard title="Evidence Submitted" value={number(summary.completed_with_evidence)}
                  icon={FileCheck2} color={palette.complete} />
              </div>

              <div className="sprint-team-ring-grid">
                <RateRing label="Completion Rate" value={summary.completion_rate}
                  available={totalPlanned > 0} color="#635bdb"
                  detail={totalPlanned ? `${totalCompleted} completed out of ${totalPlanned} planned activities` : 'No approved weekly activities in this month'} />
                <RateRing label="Reporting Rate" value={summary.reporting_rate}
                  available={totalPlanned > 0} color="#10a6ac"
                  detail={totalPlanned ? `${totalReported} reported out of ${totalPlanned} planned activities` : 'No activities available for reporting'} />
                <RateRing label="Evidence Coverage" value={summary.evidence_coverage_rate}
                  available={totalCompleted > 0} color="#16a34a"
                  detail={totalCompleted ? `${number(summary.completed_with_evidence)} completed activities with evidence` : 'No completed activities available for evidence coverage'} />
              </div>

              <div className="sprint-team-deep-panels">
                <WeeklyTrend key={month} weeks={result.weekly_trend} />
                <PlanningPipeline pipeline={result.planning_pipeline} />
              </div>

              <div className="sprint-team-panels">
                <section className="card" style={{ padding: 20, borderRadius: 16 }}>
                  <h3 style={{ marginTop: 0, fontSize: 17, display: 'flex', alignItems: 'center', gap: 9 }}>
                    <PieChart size={19} color="#635bdb" /> Activity Distribution
                  </h3>
                  {totalPlanned === 0 ? (
                    <p style={{ color: 'var(--text-muted,#64748b)', fontSize: 13 }}>
                      No approved weekly activities are available for this month. Percentages are not applicable.
                    </p>
                  ) : (
                    <>
                      <DistributionBar label="Completed" value={summary.completed} total={totalPlanned} color="#16a34a" />
                      <DistributionBar label="In Progress" value={summary.in_progress} total={totalPlanned} color="#f59e0b" />
                      <DistributionBar label="Not Completed" value={summary.not_completed} total={totalPlanned} color="#ef4444" />
                      <DistributionBar label="Unreported" value={summary.unreported} total={totalPlanned} color="#94a3b8" />
                    </>
                  )}
                </section>

                <section className="card" style={{ padding: 20, borderRadius: 16 }}>
                  <h3 style={{ marginTop: 0, fontSize: 17, display: 'flex', alignItems: 'center', gap: 9 }}>
                    <Activity size={19} color="#635bdb" /> Department Comparison
                  </h3>
                  {departmentStats.length === 0 ? (
                    <p style={{ color: 'var(--text-muted, #64748b)', fontSize: 13 }}>
                      No department data available.
                    </p>
                  ) : departmentStats.map(item => (
                    <div className="sprint-team-dept-row" key={item.name}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, marginBottom: 8 }}>
                        <span><strong>{item.name}</strong> <span style={{ color: 'var(--text-muted,#64748b)' }}>· {item.employees} employees</span></span>
                        <strong>{item.planned ? `${rate(item.completion_rate).toFixed(1)}%` : 'N/A'}</strong>
                      </div>
                      <ProgressBar value={item.completion_rate ?? 0} color="#635bdb" />
                      <div style={{ color: 'var(--text-muted,#64748b)', fontSize: 12, marginTop: 6 }}>
                        {item.planned ? `${item.completed} of ${item.planned} completed` : 'No approved activities'}
                      </div>
                    </div>
                  ))}
                </section>
              </div>

              <section className="card" style={{ padding: 20 }}>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 0 }}>
                  <TrendingUp size={20} /> Employee Performance
                </h3>

                <div className="sprint-team-filters">
                  <div style={{ position: 'relative' }}>
                    <Search size={16} style={{
                      position: 'absolute', left: 11, top: 12,
                      color: 'var(--text-muted, #64748b)'
                    }} />
                    <input type="search" aria-label="Search employees"
                      placeholder="Search employee or code"
                      value={search}
                      onChange={event => setSearch(event.target.value)}
                      style={{
                        width: '100%', padding: '9px 12px 9px 35px',
                        borderRadius: 9, boxSizing: 'border-box',
                        color: 'inherit',
                        background: 'var(--surface, #fff)',
                        border: '1px solid var(--border, #dbe1e8)'
                      }} />
                  </div>

                  <select aria-label="Department filter"
                    value={department}
                    onChange={event => setDepartment(event.target.value)}
                    style={{
                      padding: '9px 12px', borderRadius: 9,
                      color: 'inherit', background: 'var(--surface, #fff)',
                      border: '1px solid var(--border, #dbe1e8)'
                    }}>
                    <option value="all">All Departments</option>
                    {departments.map(name => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                  <div style={{ position: 'relative' }}>
                    <ArrowUpDown size={15} aria-hidden="true" style={{ position: 'absolute', left: 11, top: 13, color: 'var(--muted,#64748b)' }} />
                    <select aria-label="Sort employees" value={sortBy} onChange={event => setSortBy(event.target.value)}
                      style={{ width: '100%', padding: '9px 12px 9px 34px', borderRadius: 9, color: 'inherit', background: 'var(--surface,#fff)', border: '1px solid var(--border,#dbe1e8)' }}>
                      <option value="completion">Completion rate</option>
                      <option value="reporting">Reporting rate</option>
                      <option value="planned">Most planned work</option>
                      <option value="name">Employee name (A–Z)</option>
                    </select>
                  </div>
                </div>
                <p style={{fontSize:12,color:'var(--muted,#64748b)',margin:'0 0 15px'}} aria-live="polite">
                  Showing {filtered.length} of {employees.length} authorised employees
                  {(search || department !== 'all') && <button type="button" className="btn btn-secondary"
                    style={{marginLeft:12,minHeight:31,padding:'4px 10px'}} onClick={() => { setSearch(''); setDepartment('all'); }}>Clear filters</button>}
                </p>

                {filtered.length === 0 ? (
                  <p style={{ color: 'var(--text-muted, #64748b)' }}>
                    {employees.length === 0 ? 'No employees are available in your authorised scope.' : 'No employees match the selected filters.'}
                  </p>
                ) : (
                  <div style={{ display: 'grid', gap: 12 }}>
                    {filtered.map(employee => (
                      <div className="sprint-team-employee" key={employee.employee_id} style={{
                        border: '1px solid var(--border, #e2e8f0)',
                        padding: 15, borderRadius: 11
                      }}>
                        <div className="sprint-team-employee-actions" style={{ marginBottom: 12 }}>
                          <div className="sprint-team-employee-name">
                            <strong>{employee.name}</strong>
                            <div style={{ fontSize: 12, color: 'var(--text-muted, #64748b)', marginTop: 3 }}>
                              {employee.employee_code || 'No code'}
                              {' · '}
                              {employee.department || 'Unassigned'}
                            </div>
                          </div>
                          <button type="button" className="btn btn-secondary"
                            onClick={() => setSelectedEmployee(employee)}>
                            View Details
                          </button>
                        </div>
                        <div className="sprint-team-employee-progress">
                          <ProgressBar value={employee.completion_rate} />
                          <strong>{number(employee.planned) ? `${rate(employee.completion_rate).toFixed(1)}%` : 'N/A'}</strong>
                        </div>
                        <div className="sprint-team-employee-meta" style={{
                          marginTop: 11, fontSize: 12, color: 'var(--text-muted, #64748b)'
                        }}>
                          <span>Completed: {number(employee.completed)}/{number(employee.planned)}</span>
                          <span>Reporting: {number(employee.planned) ? `${rate(employee.reporting_rate).toFixed(1)}%` : 'N/A'}</span>
                          <span>Evidence: {number(employee.completed) ? `${rate(employee.evidence_coverage_rate).toFixed(1)}%` : 'N/A'}</span>
                          <span>Unreported: {number(employee.unreported)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <p style={{
                fontSize: 12,
                color: 'var(--text-muted, #64748b)',
                marginTop: 14
              }}>
                Only approved weekly planning activities are counted.
                Evidence coverage measures submitted references, not independently verified work. Filters and sorting only affect this authorised result set.
              </p>
            </>
          )}
        </>
      )}
    </main>
  );
}