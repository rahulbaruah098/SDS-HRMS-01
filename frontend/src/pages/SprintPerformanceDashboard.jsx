import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, BarChart3, CheckCircle2, Clock3, AlertCircle,
  FileCheck2, RefreshCw, ListTodo, TrendingUp, CalendarDays,
  ArrowUpRight, Info, Target, CircleDot, Sparkles
} from 'lucide-react';
import { getSprintEmployeeMetrics } from '../api/sprintPlanning';

// The API is the single source of truth. Animations only present returned values:
// there are no invented activities, live updates, or simulated performance figures.
const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};
const num = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};
const pct = value => Math.min(100, Math.max(0, num(value)));
const unwrap = response => {
  const result = response?.data ?? response;
  return result?.data && !result?.counts ? result.data : result;
};
const shortDate = value => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  return match ? `${match[3]}/${match[2]}` : String(value || '');
};
const colors = {
  purple: '#6354d9', blue: '#5069d7', green: '#15976a',
  amber: '#d48d2e', red: '#d65a65', slate: '#8a96b0'
};
const workItems = [
  ['planned', 'Planned', ListTodo, 'purple', 'Assigned approved activities'],
  ['completed', 'Completed', CheckCircle2, 'green', 'Activities marked completed'],
  ['in_progress', 'In progress', Clock3, 'amber', 'Work still underway'],
  ['not_completed', 'Not completed', AlertCircle, 'red', 'Reported unfinished work'],
  ['unreported', 'Not reported', Activity, 'slate', 'Awaiting daily reporting'],
  ['completed_with_evidence', 'With evidence', FileCheck2, 'blue', 'Completed with a reference']
];

function Metric({ item, count, index }) {
  const [key, label, Icon, tone, help] = item;
  return (
    <article className="ycp-metric" style={{ '--ycp-delay': `${index * 70}ms` }}>
      <div className="ycp-metric-top">
        <span className={`ycp-icon ycp-tone-${tone}`}><Icon size={20} aria-hidden="true" /></span>
        <span className="ycp-metric-caption">{label}</span>
      </div>
      <strong className="ycp-number">{num(count).toLocaleString('en-IN')}</strong>
      <span className="ycp-metric-help">{help}</span>
    </article>
  );
}

function ProgressRing({ label, value, tone, detail, available = true, index = 0 }) {
  const [animated, setAnimated] = useState(false);
  useEffect(() => {
    setAnimated(false);
    const frame = requestAnimationFrame(() => setAnimated(true));
    return () => cancelAnimationFrame(frame);
  }, [value, available]);
  const rate = pct(value);
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="ycp-ring-block" style={{ '--ycp-delay': `${index * 110}ms` }}>
      <div className="ycp-ring-wrapper">
        <svg viewBox="0 0 136 136" className="ycp-ring-svg" role="img"
          aria-label={`${label}: ${available ? `${rate.toFixed(1)} percent` : 'Not applicable'}`}>
          <circle cx="68" cy="68" r={radius} stroke="var(--ycp-track)" strokeWidth="11" fill="none" />
          <circle cx="68" cy="68" r={radius} stroke={available ? colors[tone] : colors.slate}
            strokeWidth="11" strokeLinecap="round" fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - (animated && available ? rate : 0) / 100)}
            transform="rotate(-90 68 68)" className="ycp-ring-progress" />
          <text x="68" y="71" className="ycp-ring-value" textAnchor="middle">
            {available ? `${rate.toFixed(1)}%` : 'N/A'}
          </text>
          <text x="68" y="88" className="ycp-ring-caption" textAnchor="middle">
            {available ? 'of eligible work' : 'no activity'}
          </text>
        </svg>
      </div>
      <strong>{label}</strong>
      <p>{detail}</p>
    </div>
  );
}

function DailyTrend({ points }) {
  const rows = useMemo(() => (
    (Array.isArray(points) ? points : [])
      .filter(item => item && typeof item === 'object')
      .map((item, index) => ({
        key: String(item.date || item.work_date || index),
        date: String(item.date || item.work_date || ''),
        planned: num(item.planned),
        completed: num(item.completed)
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
  ), [points]);
  const [selectedDate, setSelectedDate] = useState('');
  const [metric, setMetric] = useState('both');
  const selectedIndex = rows.findIndex(row => row.date === selectedDate);
  const focus = rows[selectedIndex >= 0 ? selectedIndex : rows.length - 1];
  const ceiling = Math.max(1, ...rows.flatMap(row => [row.planned, row.completed]));
  // Activity counts are integers. Fractional Y-axis labels are misleading.
  const axisTop = ceiling <= 4 ? ceiling : Math.ceil(ceiling / 4) * 4;
  const ticks = ceiling <= 4
    ? Array.from({ length: ceiling + 1 }, (_, index) => ceiling - index)
    : [4, 3, 2, 1, 0].map(quarter => axisTop * quarter / 4);
  if (!rows.length) {
    return <div className="ycp-empty-chart"><BarChart3 size={28} /><strong>No daily trend yet</strong>
      <span>Approved weekly activities will appear here as they are scheduled and reported.</span></div>;
  }
  return (
    <div className="ycp-chart-wrap">
      <div className="ycp-chart-toolbar">
        <div className="ycp-chart-metric-switch" role="group" aria-label="Show daily activity series">
          {[
            ['both', 'Both'], ['planned', 'Planned'], ['completed', 'Completed']
          ].map(([value, label]) => (
            <button key={value} type="button" aria-pressed={metric === value}
              className={`ycp-chart-toggle ${metric === value ? 'is-active' : ''}`}
              onClick={() => setMetric(value)}>{label}</button>
          ))}
        </div>
        <span className="ycp-chart-caption">Select a date below to inspect recorded values</span>
      </div>
      <div className="ycp-chart-scroll" role="region" tabIndex={0}
        aria-label="Scrollable daily activity chart with selectable dates">
        <div className="ycp-bar-chart" style={{ minWidth: `${Math.max(360, rows.length * 88)}px` }}>
          <div className="ycp-bar-plot" role="group" aria-label="Daily planned and completed activity bars">
            <div className="ycp-axis-labels" aria-hidden="true">
              {ticks.map((tick, index) => <span key={tick} style={{ top: `${index * 100 / (ticks.length - 1)}%` }}>{tick}</span>)}
            </div>
            <div className="ycp-gridlines" aria-hidden="true">
              {ticks.map((tick, index) => <span key={tick} className="ycp-gridline" style={{ top: `${index * 100 / (ticks.length - 1)}%` }} />)}
            </div>
            {rows.map(row => {
              const active = focus.date === row.date;
              return <button type="button" key={row.key} className={`ycp-bar-day ${active ? 'is-active' : ''}`}
                aria-pressed={active} aria-label={`${row.date}: ${row.planned} planned; ${row.completed} completed`}
                title={`${row.date}: ${row.planned} planned, ${row.completed} completed`}
                onClick={() => setSelectedDate(row.date)}>
                <span className="ycp-bar-pair">
                  {(metric === 'both' || metric === 'planned') &&
                    <span className="ycp-bar ycp-bar-planned" style={{height:`${Math.max(0, row.planned / axisTop * 100)}%`}}>
                      <span className="ycp-bar-number">{row.planned}</span>
                    </span>}
                  {(metric === 'both' || metric === 'completed') &&
                    <span className="ycp-bar ycp-bar-completed" style={{height:`${Math.max(0, row.completed / axisTop * 100)}%`}}>
                      <span className="ycp-bar-number">{row.completed}</span>
                    </span>}
                </span>
                <span className="ycp-bar-date">{shortDate(row.date)}</span>
              </button>;
            })}
          </div>
        </div>
      </div>
      <div className="ycp-legend" aria-hidden="true"><span><i className="ycp-dot purple"/> Planned</span>
        <span><i className="ycp-dot green"/> Completed</span></div>
      <div className="ycp-insight" aria-live="polite"><span className="ycp-insight-date"><CalendarDays size={15}/>{focus.date || 'Selected date'}</span>
        <span><strong>{focus.planned}</strong> planned</span><span><strong>{focus.completed}</strong> completed</span>
        <span className="ycp-insight-muted">{focus.planned ? `${(focus.completed / focus.planned * 100).toFixed(1)}% completion` : 'No planned tasks'}</span></div>
    </div>
  );
}

export default function SprintPerformanceDashboard({ employeeId, initialMonth }) {
  // Optional period from the team drill-down; standalone view keeps its current-month default.
  const [month, setMonth] = useState(() => initialMonth || currentMonth());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async (soft = false) => {
    if (soft) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const response = await getSprintEmployeeMetrics({ month, employeeId });
      const payload = unwrap(response);
      if (!payload || !payload.counts) throw new Error('The performance metrics response is incomplete.');
      setData(payload);
    } catch (err) {
      if (!soft) setData(null);
      setError(err?.message || 'Unable to load performance data.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [month, employeeId]);
  useEffect(() => { load(); }, [load]);
  const counts = data?.counts || {};
  const planned = num(counts.planned);
  const completed = num(counts.completed);
  const evidenced = num(counts.completed_with_evidence);
  const summaries = useMemo(() => workItems.map(item => ({item, value: num(counts[item[0]])})), [
    counts.planned, counts.completed, counts.in_progress, counts.not_completed,
    counts.unreported, counts.completed_with_evidence
  ]);
  const segments = [
    { label: 'Completed', count: completed, tone: 'green' },
    { label: 'In progress', count: num(counts.in_progress), tone: 'amber' },
    { label: 'Not completed', count: num(counts.not_completed), tone: 'red' },
    { label: 'Not reported', count: num(counts.unreported), tone: 'slate' }
  ];
  const tracked = segments.reduce((sum, segment) => sum + segment.count, 0);
  const available = planned > 0;
  const rates = [
    { label: 'Completion', value: data?.completion_rate, tone: 'green',
      detail: `${completed} of ${planned} planned activities completed`, eligible: available },
    { label: 'Daily reporting', value: data?.reporting_rate, tone: 'purple',
      detail: `${Math.max(0, planned - num(counts.unreported))} activities reported`, eligible: available },
    { label: 'Evidence coverage', value: data?.evidence_coverage_rate, tone: 'blue',
      detail: `${evidenced} of ${completed} completed with evidence`, eligible: completed > 0 }
  ];
  return (
    <section className="ycp-page" aria-label="Sprint performance dashboard">
      <style>{`
        .ycp-page{--ycp-accent:var(--primary,var(--primary-color,#6354d9));--ycp-surface:var(--surface,var(--card-bg,#fff));--ycp-soft:var(--surface-secondary,#f7f8ff);--ycp-track:#ebedf5;--ycp-border:var(--border,#e2e6f2);--ycp-ink:var(--text,#1c2744);--ycp-subtle:var(--text-muted,#78849d);--ycp-grid:#e5e9f2;width:100%;max-width:1390px;margin:0 auto;padding:clamp(14px,2.2vw,28px);color:var(--ycp-ink);box-sizing:border-box;min-width:0}
        .ycp-page *{box-sizing:border-box}.ycp-page button,.ycp-page input{font:inherit}
        .ycp-header{display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap;margin-bottom:23px}
        .ycp-eyebrow{font-size:11px;font-weight:800;letter-spacing:.11em;text-transform:uppercase;color:var(--ycp-accent);margin-bottom:6px}
        .ycp-title{display:flex;align-items:center;gap:12px;margin:0;font-size:clamp(22px,2.6vw,30px);letter-spacing:-.025em;line-height:1.25;font-weight:800}
        .ycp-title-icon{display:grid;place-items:center;width:42px;height:42px;border-radius:13px;color:var(--ycp-accent);background:var(--ycp-soft);border:1px solid var(--ycp-border)}
        .ycp-description{font-size:13px;line-height:1.6;color:var(--ycp-subtle);margin:9px 0 0}
        .ycp-controls{display:flex;align-items:end;gap:10px;flex-wrap:wrap}.ycp-control{display:grid;gap:6px;font-size:12px;color:var(--ycp-subtle);font-weight:750}
        .ycp-month{height:43px;padding:8px 12px;color:var(--ycp-ink);background:var(--ycp-surface);border:1px solid var(--ycp-border);border-radius:11px;min-width:170px;outline:none}
        .ycp-month:focus-visible,.ycp-btn:focus-visible,.ycp-chart-scroll:focus-visible{outline:3px solid var(--ycp-accent);outline-offset:3px}
        .ycp-btn{height:43px;display:inline-flex;align-items:center;justify-content:center;gap:8px;border:1px solid var(--ycp-border);background:var(--ycp-surface);color:var(--ycp-ink);border-radius:11px;padding:0 16px;font-size:13px;font-weight:750;cursor:pointer;transition:background .2s,transform .2s}
        .ycp-btn:hover:not(:disabled){background:var(--ycp-soft);transform:translateY(-1px)}.ycp-btn:disabled{opacity:.55;cursor:not-allowed}
        .ycp-spinning{animation:ycp-spin .8s linear infinite}@keyframes ycp-spin{to{transform:rotate(360deg)}}
        .ycp-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px;margin:0 0 16px}
        .ycp-metric,.ycp-panel,.ycp-banner,.ycp-message{background:var(--ycp-surface);border:1px solid var(--ycp-border);border-radius:17px;box-shadow:0 6px 20px rgba(28,39,68,.035)}
        .ycp-metric{min-width:0;padding:19px 20px;display:flex;flex-direction:column;gap:8px;animation:ycp-rise .55s ease both;animation-delay:var(--ycp-delay,0ms);transition:transform .2s,box-shadow .2s}
        .ycp-metric:hover{transform:translateY(-3px);box-shadow:0 10px 23px rgba(28,39,68,.08)}
        .ycp-metric-top{display:flex;align-items:center;gap:10px}.ycp-icon{display:grid;place-items:center;width:40px;height:40px;border-radius:12px;border:1px solid var(--ycp-border);background:var(--ycp-soft)}
        .ycp-tone-purple{color:${colors.purple}}.ycp-tone-green{color:${colors.green}}.ycp-tone-amber{color:${colors.amber}}.ycp-tone-red{color:${colors.red}}.ycp-tone-slate{color:${colors.slate}}.ycp-tone-blue{color:${colors.blue}}
        .ycp-metric-caption{font-size:13px;font-weight:750;color:var(--ycp-subtle)}.ycp-number{font-size:clamp(25px,2.9vw,34px);line-height:1.1;font-weight:850;font-variant-numeric:tabular-nums;letter-spacing:-.04em}
        .ycp-metric-help{font-size:11px;line-height:1.4;color:var(--ycp-subtle)}
        .ycp-contents{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:16px;margin-bottom:16px}
        .ycp-panel{padding:20px;min-width:0}.ycp-panel-title{font-size:16px;font-weight:800;display:flex;align-items:center;gap:9px;margin:0 0 7px}
        .ycp-panel-description{font-size:12px;color:var(--ycp-subtle);line-height:1.6;margin:0 0 14px}
        .ycp-rates{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}.ycp-ring-block{display:flex;align-items:center;flex-direction:column;text-align:center;animation:ycp-rise .55s ease both;animation-delay:var(--ycp-delay,0ms);min-width:0}
        .ycp-ring-wrapper{width:100%;max-width:155px}.ycp-ring-svg{display:block;width:100%;height:auto}.ycp-ring-progress{transition:stroke-dashoffset 1100ms cubic-bezier(.16,1,.3,1)}
        .ycp-ring-value{font-size:20px;font-weight:850;fill:var(--ycp-ink);font-variant-numeric:tabular-nums}.ycp-ring-caption{font-size:10px;fill:var(--ycp-subtle)}
        .ycp-ring-block>strong{font-size:12px;font-weight:800}.ycp-ring-block>p{font-size:11px;color:var(--ycp-subtle);line-height:1.45;margin:6px 0 0;max-width:150px}
        .ycp-track{height:15px;background:var(--ycp-track);overflow:hidden;border-radius:999px;display:flex;margin:23px 0 22px}
        .ycp-segment{height:100%;transition:width 1100ms cubic-bezier(.16,1,.3,1)}
        .ycp-distribution-list{display:grid;gap:13px}.ycp-distribution-row{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px}
        .ycp-distribution-label{display:flex;align-items:center;gap:9px}.ycp-dot{display:inline-block;width:9px;height:9px;border-radius:4px;flex-shrink:0}
        .ycp-dot.purple{background:${colors.purple}}.ycp-dot.green{background:${colors.green}}.ycp-dot.amber{background:${colors.amber}}.ycp-dot.red{background:${colors.red}}.ycp-dot.slate{background:${colors.slate}}
        .ycp-distribution-row strong{font-variant-numeric:tabular-nums}.ycp-chart-panel{padding:20px}
        .ycp-chart-toolbar{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:10px}
        .ycp-legend{display:flex;align-items:center;gap:17px}.ycp-legend>span{display:flex;align-items:center;gap:7px;font-weight:750;font-size:12px}
        .ycp-chart-caption{font-size:11px;color:var(--ycp-subtle)}.ycp-chart-scroll{overflow-x:auto;width:100%;scrollbar-width:thin;overscroll-behavior-x:contain;padding-top:14px}
        .ycp-chart-metric-switch{display:flex;flex-wrap:wrap;gap:6px}.ycp-chart-toggle{border:1px solid var(--ycp-border);background:var(--ycp-surface);color:var(--ycp-ink);font:inherit;font-size:12px;font-weight:700;border-radius:9px;min-height:34px;padding:6px 11px;cursor:pointer}
        .ycp-chart-toggle.is-active{color:var(--ycp-accent);border-color:var(--ycp-accent);background:var(--ycp-soft)}.ycp-chart-toggle:focus-visible,.ycp-bar-day:focus-visible{outline:3px solid var(--ycp-accent);outline-offset:2px}
        .ycp-bar-chart{width:100%;padding:0 14px 3px}.ycp-bar-plot{position:relative;display:flex;align-items:stretch;gap:12px;height:244px;border-bottom:1px solid var(--ycp-border);padding:0 0 0 37px}
        .ycp-gridlines{position:absolute;left:42px;right:0;top:0;bottom:32px;display:flex;flex-direction:column;pointer-events:none}.ycp-gridline{position:absolute;left:0;right:0;width:100%;border-top:1px dashed var(--ycp-border);height:0}.ycp-axis-labels{position:absolute;left:0;top:0;bottom:32px;width:33px;display:flex;flex-direction:column;pointer-events:none}.ycp-axis-labels span{position:absolute;right:0;display:block;min-width:25px;text-align:right;white-space:nowrap;line-height:1;font-variant-numeric:tabular-nums;font-size:11px;color:var(--ycp-subtle);transform:translateY(-50%)}.ycp-axis-labels span:first-child{transform:translateY(0)}.ycp-axis-labels span:last-child{transform:translateY(-100%)}
        .ycp-bar-day{position:relative;z-index:1;appearance:none;display:flex;flex:1 1 75px;min-width:66px;max-width:140px;align-items:center;flex-direction:column;justify-content:flex-end;border:1px solid transparent;background:transparent;border-radius:9px 9px 0 0;cursor:pointer;padding:0 7px 0;color:var(--ycp-ink);font:inherit}
        .ycp-bar-day:hover,.ycp-bar-day.is-active{background:var(--ycp-soft);border-color:var(--ycp-border)}.ycp-bar-pair{height:210px;width:100%;display:flex;align-items:flex-end;justify-content:center;gap:7px;position:relative}.ycp-bar{width:min(35%,37px);min-width:14px;position:relative;display:flex;align-items:flex-start;justify-content:center;border-radius:6px 6px 0 0;min-height:0;animation:ycp-bar-rise .9s cubic-bezier(.16,1,.3,1) both;transform-origin:bottom}
        .ycp-bar-planned{background:${colors.purple}}.ycp-bar-completed{background:${colors.green}}.ycp-bar-number{position:absolute;bottom:calc(100% + 5px);font-size:11px;font-weight:800;color:var(--ycp-ink)}.ycp-bar-date{font-size:11px;font-weight:700;margin:10px 0 7px;white-space:nowrap;color:var(--ycp-subtle)}.ycp-bar-day.is-active .ycp-bar-date{color:var(--ycp-accent)}.ycp-chart-wrap>.ycp-legend{margin:12px 0 6px;justify-content:flex-start}
        @keyframes ycp-bar-rise{from{transform:scaleY(.03);opacity:.5}to{transform:scaleY(1);opacity:1}}
        .ycp-chart-svg{max-width:none;display:block}.ycp-chart-point{transition:r .25s}.ycp-draw-line{stroke-dasharray:1800;stroke-dashoffset:1800;animation:ycp-draw 1.25s ease forwards}@keyframes ycp-draw{to{stroke-dashoffset:0}}
        .ycp-insight{background:var(--ycp-soft);border:1px solid var(--ycp-border);border-radius:11px;padding:12px 14px;display:flex;gap:20px;align-items:center;flex-wrap:wrap;font-size:12px;margin-top:8px}
        .ycp-insight-date{display:inline-flex;align-items:center;gap:7px;font-weight:800;color:var(--ycp-accent)}.ycp-insight strong{font-weight:850;font-size:14px}.ycp-insight-muted{margin-left:auto;color:var(--ycp-subtle)}
        .ycp-empty-chart{min-height:210px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:11px;text-align:center;color:var(--ycp-subtle);padding:20px}
        .ycp-empty-chart strong{color:var(--ycp-ink)}.ycp-empty-chart span{max-width:390px;font-size:12px;line-height:1.6}
        .ycp-banner{margin-bottom:16px;padding:14px 17px;display:flex;align-items:center;gap:10px;font-size:12px;line-height:1.5;color:var(--ycp-subtle)}.ycp-message{padding:22px;margin-bottom:18px}.ycp-message strong{display:block;margin-bottom:5px}
        .ycp-footnote{display:flex;align-items:flex-start;gap:8px;color:var(--ycp-subtle);font-size:11px;line-height:1.6;margin:16px 0 0}
        @keyframes ycp-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        @media(max-width:1000px){.ycp-contents{grid-template-columns:1fr}.ycp-rates{gap:12px}}
        @media(max-width:800px){.ycp-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @media(max-width:550px){.ycp-header{align-items:stretch}.ycp-controls{display:grid;grid-template-columns:1fr auto;width:100%}.ycp-control{min-width:0}.ycp-month{width:100%;min-width:0}.ycp-stats{gap:9px}.ycp-metric{padding:14px}.ycp-metric-help{font-size:10px}.ycp-panel{padding:15px}.ycp-rates{grid-template-columns:1fr;gap:18px}.ycp-ring-wrapper{max-width:125px}.ycp-ring-block>p{max-width:250px}.ycp-insight{gap:10px}.ycp-insight-muted{margin-left:0}}
        @media(max-width:355px){.ycp-stats{grid-template-columns:1fr}.ycp-controls{grid-template-columns:1fr}.ycp-btn{width:100%}}
        @media(prefers-reduced-motion:reduce){.ycp-page *{animation:none!important;transition:none!important}.ycp-draw-line{stroke-dasharray:none;stroke-dashoffset:0}}
      `}</style>
      <header className="ycp-header">
        <div>
          <div className="ycp-eyebrow">YourComate · Workforce performance</div>
          <h2 className="ycp-title"><span className="ycp-title-icon"><TrendingUp size={23}/></span>
            {employeeId ? 'Employee Sprint Performance' : 'My Sprint Performance'}</h2>
          <p className="ycp-description">A clear view of planned work, daily reporting and documented outcomes.</p>
        </div>
        <div className="ycp-controls">
          <label className="ycp-control"><span>Performance month</span><input className="ycp-month" type="month" aria-label="Performance month"
            value={month} onChange={e => setMonth(e.target.value)} /></label>
          <button type="button" className="ycp-btn" disabled={loading || refreshing} onClick={() => load(true)}>
            <RefreshCw size={15} className={loading || refreshing ? 'ycp-spinning' : ''}/>{refreshing ? 'Updating…' : 'Refresh data'}
          </button>
        </div>
      </header>
      {loading && <div className="ycp-message" role="status" aria-live="polite"><span className="ycp-spinning"><RefreshCw size={17}/></span> Loading performance data…</div>}
      {error && <div className="ycp-message" role="alert"><strong>Could not refresh performance data</strong><p>{error}</p><button type="button" className="ycp-btn" onClick={() => load(Boolean(data))}>Try again</button></div>}
      {!loading && data && <>
        <div className="ycp-stats">{summaries.map(({item,value}, index) => <Metric key={item[0]} item={item} count={value} index={index}/>)}</div>
        {!available && <div className="ycp-banner" role="status"><Info size={18}/>
          No activities in approved weekly plans for this month. Rates are shown as N/A rather than 0% because there is no eligible work to measure.</div>}
        <div className="ycp-contents">
          <section className="ycp-panel"><h3 className="ycp-panel-title"><Target size={19}/> Performance rates</h3>
            <p className="ycp-panel-description">Calculated only from approved weekly activities. Rings animate when new data loads.</p>
            <div className="ycp-rates">{rates.map((rate, index) => <ProgressRing key={rate.label} {...rate} available={rate.eligible} index={index}/>)}</div>
          </section>
          <section className="ycp-panel"><h3 className="ycp-panel-title"><CircleDot size={19}/> Work status breakdown</h3>
            <p className="ycp-panel-description">How activities are distributed across their latest recorded statuses.</p>
            <div className="ycp-track" role="img" aria-label={`Work status distribution across ${planned} planned activities`}>
              {segments.map(segment => <div key={segment.label} className="ycp-segment" title={`${segment.label}: ${segment.count}`}
                style={{width:`${tracked ? segment.count / tracked * 100 : 0}%`,background:colors[segment.tone]}}/>)}
            </div>
            <div className="ycp-distribution-list">{segments.map(segment =>
              <div className="ycp-distribution-row" key={segment.label}><span className="ycp-distribution-label"><i className={`ycp-dot ${segment.tone}`}/>{segment.label}</span>
                <strong>{segment.count.toLocaleString('en-IN')}</strong></div>)}</div>
          </section>
        </div>
        <section className="ycp-panel ycp-chart-panel"><h3 className="ycp-panel-title"><BarChart3 size={19}/> Daily activity trend</h3>
          <p className="ycp-panel-description">Interactive daily trend from actual planning records—not a simulated live feed.</p>
          <DailyTrend points={data.daily_trend}/>
        </section>
        <p className="ycp-footnote"><Info size={15}/><span>Only approved weekly plans contribute to these figures. Evidence coverage counts submitted references and does not independently verify work quality.{data.evidence_note && !/evidence coverage|submitted references|independent.*verif/i.test(String(data.evidence_note)) ? ` ${data.evidence_note}` : ''}</span></p>
      </>}
    </section>
  );
}
