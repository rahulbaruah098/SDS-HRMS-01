import { useEffect, useMemo, useState } from 'react';
import {
  Activity, ArrowUpRight, CalendarDays, CheckCircle2, Clock3,
  AlertCircle, ListTodo, RefreshCw, BarChart3,
  Info, ClipboardList
} from 'lucide-react';
import { getSprintEmployeeMetrics } from '../api/sprintPlanning';

// All figures originate from the authorised employee-metrics endpoint.
const monthNow = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};
const amount = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};
const percent = value => Math.max(0, Math.min(100, amount(value)));
const extract = response => {
  const result = response?.data ?? response;
  return result?.counts ? result : result?.data ?? result;
};
const displayCount = value => amount(value).toLocaleString('en-IN');
const displayDay = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return String(value || '');
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'
  }).format(parsed);
};
const rates = [
  { key: 'completion_rate', title: 'Activity completion', tone: 'success' },
  { key: 'reporting_rate', title: 'Daily reporting', tone: 'primary' },
  { key: 'evidence_coverage_rate', title: 'Evidence references', tone: 'info' }
];
const workStatuses = [
  { key: 'completed', title: 'Completed', tone: 'success', icon: CheckCircle2 },
  { key: 'in_progress', title: 'In progress', tone: 'warning', icon: Clock3 },
  { key: 'not_completed', title: 'Not completed', tone: 'danger', icon: AlertCircle },
  { key: 'unreported', title: 'Not reported', tone: 'muted', icon: Activity }
];

function MetricCard({ Icon, label, value, tone, help }) {
  return (
    <article className={`scs-stat scs-tone-${tone}`}>
      <span className="scs-stat-icon"><Icon size={18} aria-hidden="true" /></span>
      <div className="scs-stat-copy">
        <span>{label}</span>
        <strong>{displayCount(value)}</strong>
        <small>{help}</small>
      </div>
    </article>
  );
}

function RateLine({ title, value, available, tone, detail }) {
  const score = percent(value);
  return (
    <div className="scs-rate-line">
      <div className="scs-rate-label"><span>{title}</span><strong>{available ? `${score.toFixed(1)}%` : 'N/A'}</strong></div>
      <div className="scs-rate-track" role={available ? 'progressbar' : 'img'}
        aria-label={`${title}: ${available ? `${score.toFixed(1)} percent` : 'Not applicable'}`}
        {...(available ? { 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': score } : {})}>
        <span className={`scs-fill scs-fill-${tone}`} style={{ width: `${available ? score : 0}%` }} />
      </div>
      <small>{detail}</small>
    </div>
  );
}

export default function SprintDashboardSummary({ setPage, employeeId, compact = false }) {
  const [month, setMonth] = useState(monthNow);
  const [reload, setReload] = useState(0);
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedDate, setSelectedDate] = useState('');

  // Ignore superseded requests when the month or employee changes.
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setMetrics(null);
    (async () => {
      try {
        const response = await getSprintEmployeeMetrics({
          month,
          ...(employeeId ? { employeeId } : {})
        });
        const result = extract(response);
        if (!result || !result.counts || typeof result.counts !== 'object') {
          throw new Error('The Sprint progress response is incomplete.');
        }
        if (active) setMetrics(result);
      } catch (err) {
        if (active) setError(err?.message || 'Unable to load Sprint progress.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [month, employeeId, reload]);

  const counts = metrics?.counts || {};
  const planned = amount(counts.planned);
  const completed = amount(counts.completed);
  const reported = Math.max(0, planned - amount(counts.unreported));
  const evidenced = amount(counts.completed_with_evidence);
  const daily = useMemo(() => (
    (Array.isArray(metrics?.daily_trend) ? metrics.daily_trend : [])
      .filter(item => item && /^\d{4}-\d{2}-\d{2}$/.test(String(item.date || '')))
      .slice().sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .slice(-7)
  ), [metrics]);
  const chosenDay = daily.find(day => day.date === selectedDate) || daily[daily.length - 1];
  const chartMax = Math.max(1, ...daily.map(day => amount(day.planned)));
  const noActivityTitle = amount(metrics?.weekly_plan_count) > 0
    ? 'No activities scheduled for this month'
    : 'No approved weekly plans for this month';

  return (
    <section className="card sprint-dashboard-summary" aria-label="Sprint progress summary">
      <style>{`
        .sprint-dashboard-summary{--scs-panel:var(--surface,#fff);--scs-soft:var(--surface2,#f1f5f9);--scs-border:var(--line,#e2e8f0);--scs-text:var(--ink,#0f172a);--scs-muted:var(--muted,#64748b);--scs-accent:var(--primary,#4f46e5);--scs-success:var(--success,#059669);--scs-warning:var(--warning,#d97706);--scs-danger:var(--danger,#b91c1c);--scs-info:var(--info,#0284c7);background:var(--scs-panel);color:var(--scs-text);border:1px solid var(--scs-border);border-radius:17px;padding:clamp(15px,2vw,24px);min-width:0}
        .sprint-dashboard-summary *{box-sizing:border-box}
        .sprint-dashboard-summary .scs-header{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;margin-bottom:20px}
        .sprint-dashboard-summary .scs-header-copy{display:flex;gap:12px;align-items:flex-start;min-width:0}
        .sprint-dashboard-summary .scs-header-icon{flex:0 0 43px;display:grid;place-items:center;width:43px;height:43px;background:var(--primarySoft,#eef2ff);color:var(--scs-accent);border-radius:13px}
        .sprint-dashboard-summary .scs-eyebrow{display:block;font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:var(--scs-accent);font-weight:800;margin:0 0 4px}
        .sprint-dashboard-summary h3{font-size:19px;line-height:1.25;letter-spacing:-.02em;margin:0}
        .sprint-dashboard-summary .scs-subtitle{font-size:12px;line-height:1.6;color:var(--scs-muted);margin:6px 0 0}
        .sprint-dashboard-summary .scs-controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
        .sprint-dashboard-summary .scs-month{height:41px;min-width:155px;max-width:100%;border:1px solid var(--scs-border);border-radius:10px;background:var(--scs-panel);color:var(--scs-text);padding:7px 9px;font:inherit;font-size:13px}
        .sprint-dashboard-summary .scs-action{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:41px;border-radius:10px;border:1px solid var(--scs-border);background:var(--scs-panel);color:var(--scs-text);padding:8px 12px;font-size:12px;font-weight:700;cursor:pointer}
        .sprint-dashboard-summary .scs-action:hover:not(:disabled){border-color:var(--scs-accent);background:var(--scs-soft)}
        .sprint-dashboard-summary button:focus-visible,.sprint-dashboard-summary input:focus-visible{outline:3px solid var(--scs-accent);outline-offset:2px}
        .sprint-dashboard-summary .scs-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,145px),1fr));gap:10px;margin-bottom:17px}
        .sprint-dashboard-summary .scs-stat{display:flex;flex-direction:column;gap:10px;min-width:0;background:var(--scs-panel);border:1px solid var(--scs-border);border-radius:13px;padding:15px;animation:scs-up .42s ease both}
        .sprint-dashboard-summary .scs-stat-icon{display:grid;place-items:center;width:33px;height:33px;border-radius:10px;background:var(--scs-soft);color:var(--scs-accent)}
        .sprint-dashboard-summary .scs-tone-success .scs-stat-icon{background:var(--successSoft,#ecfdf5);color:var(--scs-success)}
        .sprint-dashboard-summary .scs-tone-warning .scs-stat-icon{background:var(--warningSoft,#fffbeb);color:var(--scs-warning)}
        .sprint-dashboard-summary .scs-tone-danger .scs-stat-icon{background:var(--dangerSoft,#fee2e2);color:var(--scs-danger)}
        .sprint-dashboard-summary .scs-tone-muted .scs-stat-icon{color:var(--scs-muted)}
        .sprint-dashboard-summary .scs-stat-copy{display:flex;flex-direction:column;gap:4px;min-width:0}
        .sprint-dashboard-summary .scs-stat-copy>span{font-size:12px;color:var(--scs-muted);font-weight:700}
        .sprint-dashboard-summary .scs-stat-copy strong{font-size:clamp(23px,2.7vw,30px);line-height:1.1;letter-spacing:-.04em;font-variant-numeric:tabular-nums}
        .sprint-dashboard-summary .scs-stat-copy small{font-size:11px;color:var(--scs-muted);line-height:1.4}
        .sprint-dashboard-summary .scs-insights{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:12px}
        .sprint-dashboard-summary .scs-panel{border:1px solid var(--scs-border);border-radius:13px;padding:17px;min-width:0}
        .sprint-dashboard-summary .scs-panel h4{font-size:14px;letter-spacing:-.01em;margin:0 0 6px;display:flex;align-items:center;gap:8px}
        .sprint-dashboard-summary .scs-panel-intro{margin:0 0 15px;color:var(--scs-muted);font-size:11px;line-height:1.6}
        .sprint-dashboard-summary .scs-rate-line{margin:0 0 15px}
        .sprint-dashboard-summary .scs-rate-line:last-child{margin-bottom:0}
        .sprint-dashboard-summary .scs-rate-label{display:flex;justify-content:space-between;gap:10px;margin-bottom:7px;font-size:12px}
        .sprint-dashboard-summary .scs-rate-label strong{font-variant-numeric:tabular-nums}
        .sprint-dashboard-summary .scs-rate-track{height:8px;background:var(--scs-soft);border-radius:99px;overflow:hidden}
        .sprint-dashboard-summary .scs-fill{height:100%;display:block;border-radius:inherit;transition:width .8s cubic-bezier(.16,1,.3,1)}
        .sprint-dashboard-summary .scs-fill-success{background:var(--scs-success)}.sprint-dashboard-summary .scs-fill-primary{background:var(--scs-accent)}.sprint-dashboard-summary .scs-fill-info{background:var(--scs-info)}
        .sprint-dashboard-summary .scs-rate-line small{color:var(--scs-muted);font-size:11px;display:block;margin-top:6px;line-height:1.4}
        .sprint-dashboard-summary .scs-status{display:grid;gap:11px}
        .sprint-dashboard-summary .scs-status-row{display:flex;justify-content:space-between;align-items:center;gap:9px;font-size:12px}
        .sprint-dashboard-summary .scs-status-row span{display:inline-flex;align-items:center;gap:9px}
        .sprint-dashboard-summary .scs-status-row strong{font-variant-numeric:tabular-nums}
        .sprint-dashboard-summary .scs-status-row svg{color:var(--scs-muted)}
        .sprint-dashboard-summary .scs-tiny-trend{border-top:1px solid var(--scs-border);margin-top:16px;padding-top:13px}
        .sprint-dashboard-summary .scs-days{display:flex;justify-content:space-between;gap:7px;align-items:end;height:86px;margin-top:12px}
        .sprint-dashboard-summary .scs-day{flex:1;min-width:0;max-width:70px;height:100%;display:flex;align-items:center;justify-content:end;flex-direction:column;gap:4px;padding:0;border:0;border-radius:7px;background:none;color:var(--scs-muted);font:inherit;cursor:pointer}
        .sprint-dashboard-summary .scs-day:hover,.sprint-dashboard-summary .scs-day[aria-pressed=true]{background:var(--scs-soft)}
        .sprint-dashboard-summary .scs-day-bar{display:block;width:min(80%,27px);background:var(--scs-accent);min-height:0;border-radius:5px 5px 0 0;transition:height .5s ease}
        .sprint-dashboard-summary .scs-day small{font-size:10px}
        .sprint-dashboard-summary .scs-single-day{width:100%;display:grid;gap:11px;padding:13px 14px;border:1px solid var(--scs-border);border-radius:11px;background:var(--scs-soft);color:var(--scs-text);text-align:left;font:inherit}
        .sprint-dashboard-summary .scs-single-day-date{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700}
        .sprint-dashboard-summary .scs-single-day-date svg{color:var(--scs-accent)}
        .sprint-dashboard-summary .scs-single-day-track{display:block;height:9px;width:100%;overflow:hidden;border-radius:99px;background:var(--scs-border)}
        .sprint-dashboard-summary .scs-single-day-track span{display:block;height:100%;border-radius:inherit;background:var(--scs-success);transition:width .6s ease}
        .sprint-dashboard-summary .scs-single-day-counts{display:flex;flex-wrap:wrap;justify-content:space-between;gap:7px 14px;font-size:11px;color:var(--scs-muted)}
        .sprint-dashboard-summary .scs-single-day-counts strong{color:var(--scs-text)}
        .sprint-dashboard-summary .scs-day-info{display:flex;flex-wrap:wrap;gap:6px 13px;align-items:center;margin-top:9px;font-size:11px;color:var(--scs-muted)}
        .sprint-dashboard-summary .scs-day-info strong{color:var(--scs-text)}
        .sprint-dashboard-summary .scs-notice{display:flex;align-items:flex-start;gap:12px;padding:18px;border-radius:12px;border:1px dashed var(--scs-border);background:var(--scs-soft);margin-bottom:14px}
        .sprint-dashboard-summary .scs-notice svg{flex-shrink:0;color:var(--scs-accent)}
        .sprint-dashboard-summary .scs-notice strong{display:block;font-size:13px;margin-bottom:4px}
        .sprint-dashboard-summary .scs-notice p{font-size:12px;line-height:1.5;color:var(--scs-muted);margin:0}
        .sprint-dashboard-summary .scs-skeleton{min-height:92px;background:var(--scs-soft);border-radius:12px;animation:scs-pulse 1.2s ease infinite alternate;margin-top:10px}
        .sprint-dashboard-summary .scs-footer{margin-top:16px;padding-top:13px;border-top:1px solid var(--scs-border);display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
        .sprint-dashboard-summary .scs-footnote{display:flex;align-items:flex-start;gap:6px;font-size:11px;line-height:1.5;color:var(--scs-muted);max-width:590px}
        .sprint-dashboard-summary .scs-footnote svg{flex-shrink:0;margin-top:1px}
        @keyframes scs-up{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes scs-pulse{from{opacity:.55}to{opacity:1}}
        @media(max-width:730px){.sprint-dashboard-summary .scs-insights{grid-template-columns:1fr}}
        @media(max-width:440px){.sprint-dashboard-summary .scs-controls{width:100%}.sprint-dashboard-summary .scs-month{flex:1;min-width:0}}
        @media(prefers-reduced-motion:reduce){.sprint-dashboard-summary *{animation:none!important;transition:none!important}}
      `}</style>
      <header className="scs-header">
        <div className="scs-header-copy">
          <span className="scs-header-icon"><Activity size={22} aria-hidden="true" /></span>
          <div>
            <span className="scs-eyebrow">Sprint planning</span>
            <h3>{employeeId ? 'Employee Sprint progress' : 'My Sprint progress'}</h3>
            <p className="scs-subtitle">A monthly snapshot of approved weekly activities and daily reporting.</p>
          </div>
        </div>
        <div className="scs-controls">
          <CalendarDays size={16} aria-hidden="true" />
          <input className="scs-month" type="month" aria-label="Sprint summary month" value={month}
            onChange={event => { if (event.target.value) setMonth(event.target.value); }} />
          <button className="scs-action" type="button" aria-label="Refresh Sprint progress"
            title="Refresh Sprint progress" onClick={() => setReload(value => value + 1)} disabled={loading}>
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        </div>
      </header>
      {loading && <div role="status" aria-label="Loading Sprint progress"><div className="scs-skeleton" /><div className="scs-skeleton" style={{ minHeight: 65 }} /></div>}
      {!loading && error && (
        <div className="scs-notice" role="alert"><AlertCircle size={20} />
          <div><strong>Couldn't load Sprint progress</strong><p>{error}</p>
            <button className="scs-action" type="button" onClick={() => setReload(value => value + 1)} style={{ marginTop: 12 }}>Try again</button>
          </div>
        </div>
      )}
      {!loading && !error && metrics && (
        <>
          <div className="scs-stats">
            <MetricCard Icon={ListTodo} label="Planned" value={planned} tone="primary" help="Approved activities" />
            <MetricCard Icon={CheckCircle2} label="Completed" value={completed} tone="success" help="Finished work" />
            <MetricCard Icon={Clock3} label="In progress" value={counts.in_progress} tone="warning" help="Work underway" />
            <MetricCard Icon={AlertCircle} label="Not completed" value={counts.not_completed} tone="danger" help="Reported unfinished" />
            {!compact && <MetricCard Icon={ClipboardList} label="Not reported" value={counts.unreported} tone="muted" help="Awaiting an update" />}
          </div>
          {planned === 0 ? (
            <div className="scs-notice" role="status"><ListTodo size={21} />
              <div><strong>{noActivityTitle}</strong><p>Completion, reporting and evidence percentages are not applicable. Approved weekly activities will appear here when scheduled for this period.</p></div>
            </div>
          ) : (
            <div className="scs-insights">
              <section className="scs-panel" aria-label="Performance rates">
                <h4><BarChart3 size={17} aria-hidden="true" /> Performance rates</h4>
                <p className="scs-panel-intro">Calculated from {displayCount(planned)} approved activities.</p>
                {rates.map(item => {
                  const eligible = item.key === 'evidence_coverage_rate' ? completed > 0 : planned > 0;
                  const detail = item.key === 'completion_rate'
                    ? `${displayCount(completed)} of ${displayCount(planned)} completed`
                    : item.key === 'reporting_rate'
                      ? `${displayCount(reported)} of ${displayCount(planned)} reported`
                      : eligible ? `${displayCount(evidenced)} of ${displayCount(completed)} with evidence references` : 'No completed activities yet';
                  return <RateLine key={item.key} title={item.title} value={metrics[item.key]}
                    available={eligible} tone={item.tone} detail={detail} />;
                })}
              </section>
              <section className="scs-panel" aria-label="Activity status breakdown">
                <h4><Activity size={17} aria-hidden="true" /> Work status</h4>
                <p className="scs-panel-intro">The latest reported state of planned work.</p>
                <div className="scs-status">
                  {workStatuses.map(item => <div className="scs-status-row" key={item.key}>
                    <span><item.icon size={15} aria-hidden="true" />{item.title}</span>
                    <strong>{displayCount(counts[item.key])}</strong>
                  </div>)}
                </div>
                {!compact && daily.length > 0 && (
                  <div className="scs-tiny-trend">
                    <h4 style={{ fontSize: 12 }}>Recent planned activities</h4>
                    {daily.length === 1 ? (
                      <div className="scs-single-day" aria-label={`Daily activity for ${displayDay(daily[0].date)}`} role="group">
                        <span className="scs-single-day-date"><CalendarDays size={16} aria-hidden="true" /> {displayDay(daily[0].date)}</span>
                        <span className="scs-single-day-track"><span style={{ width: `${amount(daily[0].planned) ? Math.min(100, 100 * amount(daily[0].completed) / amount(daily[0].planned)) : 0}%` }} /></span>
                        <span className="scs-single-day-counts"><strong>{displayCount(daily[0].planned)} planned</strong><span>{displayCount(daily[0].completed)} completed</span></span>
                      </div>
                    ) : (
                      <div className="scs-days" role="group" aria-label="Select a day to view its work count">
                        {daily.map(day => <button className="scs-day" type="button" key={day.date}
                          aria-pressed={chosenDay?.date === day.date}
                          title={`${displayDay(day.date)}: ${displayCount(day.planned)} planned, ${displayCount(day.completed)} completed`}
                          onClick={() => setSelectedDate(day.date)}>
                          <span className="scs-day-bar" style={{ height: `${Math.min(100, amount(day.planned) / chartMax * 65)}px` }} />
                          <small>{String(day.date).slice(8)}</small>
                        </button>)}
                      </div>
                    )}
                    {daily.length > 1 && chosenDay && <div className="scs-day-info" aria-live="polite">
                      <strong>{displayDay(chosenDay.date)}</strong><span>{displayCount(chosenDay.planned)} planned</span>
                      <span>{displayCount(chosenDay.completed)} completed</span>
                    </div>}
                  </div>
                )}
                {!compact && reported === 0 && <p className="scs-panel-intro" style={{ marginTop: 15, marginBottom: 0 }}>No daily activity reports recorded yet.</p>}
              </section>
            </div>
          )}
          <div className="scs-footer">
            <span className="scs-footnote"><Info size={14} aria-hidden="true" /> Evidence coverage tracks submitted references, not independently verified outcomes.</span>
            {typeof setPage === 'function' && (
              <button className="scs-action" type="button" onClick={() => setPage('sprint_planning')}>
                Open Sprint planning <ArrowUpRight size={15} aria-hidden="true" />
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
