import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, ArrowUpRight, BarChart3, CheckCircle2,
  Clock3, RefreshCw, TrendingUp, Layers3
} from 'lucide-react';
import { getSprintTeamMetrics } from '../api/sprintPlanning';

const currentMonth = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};
const number = value => {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const metric = (item, keys) => {
  for (const key of keys) {
    const value = number(item?.[key]);
    if (value !== null) return Math.max(0, value);
  }
  return null;
};
const totalKeys = ['planned', 'total_activities', 'planned_activities', 'total', 'activity_count'];
const completedKeys = ['completed', 'completed_activities', 'done'];
const inProgressKeys = ['in_progress', 'in_progress_activities', 'ongoing'];
const incompleteKeys = ['not_completed', 'not_completed_activities', 'incomplete_activities', 'incomplete'];
const pendingKeys = ['pending_approvals', 'approval_pending', 'pending_review'];
const fmt = value => value === null ? '—' : Math.round(value).toLocaleString();
const pct = (value, total) => total > 0 && value !== null ? Math.min(100, value / total * 100) : 0;
const colors = ['#6366f1', '#0d9488', '#f59e0b', '#ec4899', '#0284c7', '#8b5cf6'];

function Card({ label, value, caption, icon: Icon, color }) {
  return (
    <div className="spx-card">
      <div className="spx-card-top">
        <span>{label}</span>
        <span className="spx-icon" style={{ color }}><Icon size={19} /></span>
      </div>
      <div className="spx-value">{value}</div>
      <small>{caption}</small>
    </div>
  );
}

function Bar({ label, value, max, color, secondary, suffix = '' }) {
  const width = max > 0 ? Math.max(0, Math.min(100, value / max * 100)) : 0;
  return (
    <div className="spx-bar-row" title={`${label}: ${fmt(value)}${suffix}`}>
      <span className="spx-bar-label">{label}</span>
      <div className="spx-track">
        <div className="spx-fill" style={{ width: `${width}%`, background: color }} />
      </div>
      <strong style={{ color: secondary || '#1e293b' }}>{fmt(value)}{suffix}</strong>
    </div>
  );
}

function Panel({ title, subtitle, children }) {
  return (
    <section className="spx-panel">
      <h3>{title}</h3>
      <p>{subtitle}</p>
      {children}
    </section>
  );
}


function WeeklyTrendChart({ trend }) {
  const [hovered, setHovered] = useState(null);
  const width = 580;
  const height = 220;
  const paddingX = 42;
  const paddingY = 28;
  const max = Math.max(
    1,
    ...trend.flatMap(item => [
      item.planned || 0,
      item.completed || 0
    ])
  );

  const x = index =>
    paddingX + index *
    ((width - paddingX * 2) / Math.max(1, trend.length - 1));

  const y = value =>
    height - paddingY -
    ((value || 0) / max) * (height - paddingY * 2);

  const path = key =>
    trend.map((item, index) =>
      `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(item[key])}`
    ).join(' ');

  return (
    <div className="spx-trend">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Animated weekly planned versus completed activity trend"
        style={{ width: '100%', overflow: 'visible' }}
      >
        <defs>
          <linearGradient id="spx-trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6366f1" stopOpacity=".15"/>
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0"/>
          </linearGradient>
        </defs>

        {[0, .25, .5, .75, 1].map((fraction, index) => (
          <g key={index}>
            <line
              x1={paddingX}
              x2={width - paddingX}
              y1={y(max * fraction)}
              y2={y(max * fraction)}
              stroke="#e7eaf5"
              strokeDasharray="4 5"
            />
            <text
              x={paddingX - 9}
              y={y(max * fraction) + 4}
              fontSize="10"
              fill="#94a3b8"
              textAnchor="end"
            >
              {Math.round(max * fraction)}
            </text>
          </g>
        ))}

        {[
          { key: 'planned', color: '#94a3b8' },
          { key: 'completed', color: '#6366f1' }
        ].map(series => (
          <path
            key={series.key}
            d={path(series.key)}
            fill="none"
            stroke={series.color}
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="spx-animated-line"
            pathLength="1"
          />
        ))}

        {trend.map((item, index) => (
          <g key={`${item.name}-${index}`}>
            <circle
              cx={x(index)}
              cy={y(item.completed)}
              r={hovered === index ? 7 : 4}
              fill="#6366f1"
              stroke="white"
              strokeWidth="2"
              className="spx-trend-dot"
            />
            <circle
              cx={x(index)}
              cy={y(item.completed)}
              r="18"
              fill="transparent"
              onMouseEnter={() => setHovered(index)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(index)}
              onBlur={() => setHovered(null)}
              tabIndex="0"
              role="button"
              aria-label={`${item.name}: ${item.planned} planned, ${item.completed} completed`}
              style={{ cursor: 'pointer' }}
            />
            <text
              x={x(index)}
              y={height - 5}
              textAnchor="middle"
              fontSize="11"
              fill="#64748b"
            >
              {item.name}
            </text>
          </g>
        ))}
      </svg>

      {hovered !== null && trend[hovered] && (
        <div className="spx-trend-tooltip" role="status">
          <strong>{trend[hovered].name}</strong>
          <span>Planned: {fmt(trend[hovered].planned)}</span>
          <span>Completed: {fmt(trend[hovered].completed)}</span>
        </div>
      )}

      <div className="spx-legend">
        <span>
          <i className="spx-dot" style={{ background: '#94a3b8' }}/>
          Planned
        </span>
        <span>
          <i className="spx-dot" style={{ background: '#6366f1' }}/>
          Completed
        </span>
      </div>
    </div>
  );
}

export default function SprintAdminOverview({ setPage }) {
  const [month, setMonth] = useState(currentMonth);
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => setRefresh(v => v + 1), []);

  useEffect(() => {
    let live = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const response = await getSprintTeamMetrics({ month });
        const result = response?.data ?? response;
        if (!result?.summary || !Array.isArray(result?.employees)) {
          throw new Error('Sprint metrics response is incomplete.');
        }
        if (live) setData(result);
      } catch (err) {
        if (live) {
          setData(null);
          setError(err?.message || 'Unable to load Sprint metrics.');
        }
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [month, refresh]);

  const chart = useMemo(() => {
    const summary = data?.summary || {};
    const employees = data?.employees || [];

    const sumEmployee = keys => {
      const values = employees.map(employee => metric(employee, keys));
      return values.some(value => value !== null)
        ? values.reduce((a, b) => a + (b || 0), 0)
        : null;
    };
    const get = keys => metric(summary, keys) ?? sumEmployee(keys);

    const total = get(totalKeys);
    const completed = get(completedKeys);
    const inProgress = get(inProgressKeys);
    const incomplete = get(incompleteKeys);
    const pipeline = data?.planning_pipeline;
    const pipelinePending = pipeline
      ? (Number(pipeline.monthly?.pending_approval) || 0)
        + (Number(pipeline.weekly?.pending_approval) || 0)
      : null;
    const pending = pipelinePending ?? get(pendingKeys);

    const groups = new Map();
    for (const employee of employees) {
      const dept = String(employee.department || employee.department_name || 'Unassigned').trim();
      const item = groups.get(dept) || { name: dept, planned: 0, completed: 0, count: 0, hasCounts: false };
      const plannedValue = metric(employee, totalKeys);
      const completedValue = metric(employee, completedKeys);
      item.planned += plannedValue || 0;
      item.completed += completedValue || 0;
      item.hasCounts ||= plannedValue !== null || completedValue !== null;
      item.count++;
      groups.set(dept, item);
    }
    const departments = [...groups.values()]
      .filter(item => item.hasCounts)
      .sort((a, b) => b.planned - a.planned);

    const buckets = [
      { name: '0–24%', value: 0 },
      { name: '25–49%', value: 0 },
      { name: '50–74%', value: 0 },
      { name: '75–99%', value: 0 },
      { name: '100%', value: 0 }
    ];
    for (const employee of employees) {
      const planned = metric(employee, totalKeys);
      const done = metric(employee, completedKeys);
      if (!planned || done === null) continue;
      const rate = Math.min(100, done / planned * 100);
      const index = rate === 100 ? 4 : Math.min(3, Math.floor(rate / 25));
      buckets[index].value++;
    }

    // Do not fabricate weekly trend values.
    const rawTrend = data?.weekly_trend ?? data?.weekly_progress ?? data?.weeks;
    const trend = Array.isArray(rawTrend)
      ? rawTrend.map((entry, i) => ({
          name: String(entry.week_label || entry.week || `Week ${i + 1}`),
          planned: metric(entry, totalKeys),
          completed: metric(entry, completedKeys)
        })).filter(entry => entry.planned !== null && entry.completed !== null)
      : [];

    return { total, completed, inProgress, incomplete, pending, departments, buckets, trend };
  }, [data]);

  const completion = pct(chart.completed, chart.total);
  const knownStatus = [
    { name: 'Completed', value: chart.completed, color: '#10b981' },
    { name: 'In progress', value: chart.inProgress, color: '#6366f1' },
    { name: 'Incomplete', value: chart.incomplete, color: '#f59e0b' }
  ].filter(item => item.value !== null);
  const statusMax = Math.max(1, ...knownStatus.map(item => item.value));
  const deptMax = Math.max(1, ...chart.departments.map(item => item.planned));
  const bucketMax = Math.max(1, ...chart.buckets.map(item => item.value));
  const trendMax = Math.max(1, ...chart.trend.map(item => Math.max(item.planned, item.completed)));

  return (
    <div className="spx-root" aria-label="Organisation Sprint Analytics">
      <style>{`
        .spx-root { color:#1e293b; margin:22px 0 32px; }
        .spx-head { display:flex; justify-content:space-between; align-items:center; gap:15px; flex-wrap:wrap; margin-bottom:18px; }
        .spx-head h2 { margin:4px 0 5px; font-size:clamp(21px,2.3vw,29px); font-weight:850; letter-spacing:-.03em; }
        .spx-head p,.spx-panel p { color:#64748b; margin:0; font-size:12px; line-height:1.6; }
        .spx-eyebrow { color:#6355ca; font-size:11px; letter-spacing:.12em; font-weight:850; text-transform:uppercase; }
        .spx-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
        .spx-actions button,.spx-actions input { border:1px solid #d9def0; background:#fff; color:#334155; border-radius:10px; padding:9px 11px; font:inherit; font-size:12px; cursor:pointer; }
        .spx-actions .spx-go { background:linear-gradient(110deg,#5145cc,#7566ed); color:white; border:none; display:flex; align-items:center; gap:7px; }
        .spx-cards { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin-bottom:13px; }
        .spx-card,.spx-panel { border:1px solid #e5e9f4; background:linear-gradient(150deg,#fff,#f8f9ff); border-radius:17px; box-shadow:0 8px 25px rgba(25,35,85,.045); animation:spx-rise .55s ease both; }
        .spx-card { padding:17px; }
        .spx-card-top { display:flex; justify-content:space-between; align-items:center; gap:5px; color:#64748b; font-size:12px; font-weight:750; }
        .spx-icon { width:35px; height:35px; border-radius:11px; background:#f0efff; display:grid; place-items:center; }
        .spx-value { font-size:clamp(24px,3vw,34px); font-weight:850; letter-spacing:-.04em; margin:7px 0; }
        .spx-card small { color:#94a3b8; font-size:11px; }
        .spx-panels { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:13px; }
        .spx-panel { padding:20px; min-width:0; }
        .spx-panel h3 { font-size:16px; margin:0 0 5px; font-weight:800; }
        .spx-ring { display:grid; place-items:center; width:190px; height:190px; border-radius:50%; margin:25px auto; background:conic-gradient(#6255d9 0 var(--fill),#e9eaf8 var(--fill) 100%); animation:spx-rise .75s ease both; }
        .spx-ring > div { background:white; width:150px; height:150px; border-radius:50%; display:flex; flex-direction:column; align-items:center; justify-content:center; }
        .spx-ring strong { font-size:36px; font-weight:850; }
        .spx-ring span { color:#94a3b8; font-size:11px; font-weight:700; }
        .spx-bar-row { display:grid; grid-template-columns:105px minmax(0,1fr) 43px; gap:10px; align-items:center; margin-top:14px; font-size:12px; }
        .spx-bar-label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:700; }
        .spx-track { height:12px; background:#e9edf7; border-radius:20px; overflow:hidden; }
        .spx-fill { height:100%; border-radius:20px; transform-origin:left; animation:spx-grow 1s ease both; }
        .spx-dept { margin-top:18px; }
        .spx-dept-head { display:flex; justify-content:space-between; gap:8px; font-size:12px; font-weight:700; margin-bottom:7px; }
        .spx-group { display:grid; gap:4px; }
        .spx-group .spx-track { height:9px; }
        .spx-legend { display:flex; gap:14px; flex-wrap:wrap; color:#64748b; font-size:11px; margin-top:17px; }
        .spx-dot { display:inline-block; width:9px; height:9px; border-radius:3px; margin-right:5px; }
        .spx-columns { display:flex; align-items:flex-end; justify-content:space-around; gap:10px; height:175px; margin-top:24px; border-bottom:1px solid #dde3f1; }
        .spx-column-item { flex:1; max-width:90px; height:100%; display:flex; flex-direction:column; justify-content:flex-end; align-items:center; gap:5px; }
        .spx-column-item strong { font-size:11px; }
        .spx-column-item span { text-align:center; font-size:10px; color:#64748b; }
        .spx-column { width:70%; min-height:2px; border-radius:8px 8px 0 0; background:linear-gradient(180deg,#7366e8,#5145c7); transform-origin:bottom; animation:spx-risebar .9s ease both; }
        .spx-empty { margin-top:20px!important; color:#94a3b8!important; }
        .spx-error { padding:13px; border-radius:10px; background:#fff1f2; color:#be123c; margin-bottom:12px; font-size:12px; }
        .spx-skeleton { opacity:.6; }

        .spx-trend { position:relative; margin-top:20px; }
        .spx-trend-tooltip {
          display:flex;
          gap:14px;
          align-items:center;
          flex-wrap:wrap;
          background:#f0f1ff;
          border:1px solid #dfe2ff;
          color:#3730a3;
          padding:11px 13px;
          border-radius:11px;
          font-size:12px;
          margin-top:8px;
          animation:spx-rise .2s ease both;
        }
        .spx-animated-line {
          stroke-dasharray:1;
          stroke-dashoffset:1;
          animation:spx-draw 1.6s ease forwards;
        }
        .spx-trend-dot {
          transition:r .2s ease;
        }
        .spx-card {
          transition:transform .25s ease,box-shadow .25s ease;
        }
        .spx-card:hover {
          transform:translateY(-4px);
          box-shadow:0 15px 35px rgba(55,48,163,.12);
        }
        .spx-panel {
          transition:box-shadow .25s ease;
        }
        .spx-panel:hover {
          box-shadow:0 14px 38px rgba(55,48,163,.09);
        }
        .spx-fill {
          transition:width .8s cubic-bezier(.2,.8,.2,1);
        }
        @keyframes spx-draw {
          to { stroke-dashoffset:0; }
        }
        @keyframes spx-rise { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
        @keyframes spx-grow { from { transform:scaleX(0); } to { transform:scaleX(1); } }
        @keyframes spx-risebar { from { transform:scaleY(0); } to { transform:scaleY(1); } }
        @media(max-width:1050px) { .spx-cards { grid-template-columns:repeat(2,minmax(0,1fr)); } }
        @media(max-width:750px) { .spx-panels { grid-template-columns:1fr; } }
        @media(max-width:450px) { .spx-cards { grid-template-columns:1fr; } .spx-bar-row { grid-template-columns:80px minmax(0,1fr) 35px; } }
        @media(prefers-reduced-motion:reduce) { .spx-card,.spx-panel,.spx-ring,.spx-fill,.spx-column,.spx-animated-line { animation:none; transition:none; } .spx-animated-line { stroke-dashoffset:0; } }
      `}</style>

      <div className="spx-head">
        <div>
          <div className="spx-eyebrow">Organisation Performance</div>
          <h2>Sprint Analytics Dashboard</h2>
        </div>
        <div className="spx-actions">
          <input aria-label="Sprint month" type="month" value={month} onChange={e => setMonth(e.target.value)} />
          <button type="button" aria-label="Refresh analytics" onClick={reload}><RefreshCw size={16}/></button>
          <button className="spx-go" type="button" onClick={() => setPage?.('sprint_planning')}>
            Open Sprint Planning <ArrowUpRight size={15}/>
          </button>
        </div>
      </div>

      {error && <div className="spx-error" role="alert">{error}</div>}

      <div className={`spx-cards ${loading ? 'spx-skeleton' : ''}`}>
        <Card label="Planned Activities" value={loading ? '…' : fmt(chart.total)} caption="Approved weekly plans" icon={Layers3} color="#6255d9"/>
        <Card label="Completed" value={loading ? '…' : fmt(chart.completed)} caption="Work marked completed" icon={CheckCircle2} color="#0d9488"/>
        <Card label="Pending Approvals" value={loading ? '…' : fmt(chart.pending)} caption={chart.pending === null ? 'Not provided by this API' : 'Awaiting approval'} icon={Clock3} color="#d97706"/>
        <Card label="Completion Rate" value={loading ? '…' : chart.total > 0 && chart.completed !== null ? `${completion.toFixed(1)}%` : '—'} caption="Completed ÷ planned" icon={TrendingUp} color="#0284c7"/>
      </div>

      <div className="spx-panels">
        <Panel title="Overall Completion" subtitle="Completion of approved planned activities">
          <div className="spx-ring" key={`${month}-${refresh}`} style={{ '--fill': `${completion}%` }}>
            <div>
              <strong>{chart.total > 0 ? `${completion.toFixed(0)}%` : '—'}</strong>
              <span>WORK COMPLETED</span>
            </div>
          </div>
        </Panel>

        <Panel title="Activity Status Distribution" subtitle="Animated comparison of reported work statuses">
          {knownStatus.length ? knownStatus.map(item => (
            <Bar key={item.name} label={item.name} value={item.value} max={statusMax} color={item.color}/>
          )) : <p className="spx-empty">Activity status totals are not available.</p>}
        </Panel>

        <Panel title="Department Performance" subtitle="Planned versus completed work, grouped by department">
          {chart.departments.length ? chart.departments.slice(0,8).map((item, index) => (
            <div className="spx-dept" key={item.name} title={`${item.name}: ${item.completed} completed of ${item.planned} planned`}>
              <div className="spx-dept-head"><span>{item.name}</span><span>{item.completed}/{item.planned}</span></div>
              <div className="spx-group">
                <div className="spx-track"><div className="spx-fill" style={{ width:`${item.planned/deptMax*100}%`,background:'#cbd5e1' }}/></div>
                <div className="spx-track"><div className="spx-fill" style={{ width:`${item.completed/deptMax*100}%`,background:colors[index%colors.length] }}/></div>
              </div>
            </div>
          )) : <p className="spx-empty">No department metrics are available.</p>}
          <div className="spx-legend"><span><i className="spx-dot" style={{background:'#cbd5e1'}}/>Planned</span><span><i className="spx-dot" style={{background:'#6366f1'}}/>Completed (department colours)</span></div>
        </Panel>

        <Panel title="Department Completion Rates" subtitle="Share of department activities marked completed">
          {chart.departments.length ? chart.departments.slice(0,8).map((item, index) => (
            <Bar
              key={item.name} label={item.name}
              value={Number(pct(item.completed,item.planned).toFixed(1))}
              max={100} suffix="%"
              color={colors[index%colors.length]}
            />
          )) : <p className="spx-empty">No department completion data is available.</p>}
        </Panel>

        <Panel title="Completion Distribution" subtitle="Number of employees grouped by completion percentage, without individual names">
          {chart.buckets.some(item => item.value > 0) ? (
            <div className="spx-columns">
              {chart.buckets.map((item,index) => (
                <div key={item.name} className="spx-column-item" title={`${item.value} employees in ${item.name} completion range`}>
                  <strong>{item.value}</strong>
                  <div className="spx-column" style={{ height:`${item.value/bucketMax*115}px`,background:colors[index%colors.length] }}/>
                  <span>{item.name}</span>
                </div>
              ))}
            </div>
          ) : <p className="spx-empty">No employee completion distribution is available.</p>}
        </Panel>


        <Panel
          title="Monthly and Weekly Planning Pipeline"
          subtitle="Planning submissions and approvals by status"
        >
          {data?.planning_pipeline ? (
            <div>
              {[
                ['Monthly Plans', 'monthly'],
                ['Weekly Plans', 'weekly']
              ].map(([heading, key]) => {
                const counts = data.planning_pipeline[key] || {};
                const total = data.planning_pipeline[`${key}_total`] || 0;
                const stages = [
                  ['Draft', 'draft', '#94a3b8'],
                  ['Pending Approval', 'pending_approval', '#f59e0b'],
                  ['Approved', 'approved', '#10b981'],
                  ['Rejected', 'rejected', '#ef4444'],
                  ['Other', 'other', '#6366f1']
                ];

                return (
                  <div key={key} style={{ marginTop: 20 }}>
                    <div className="spx-dept-head">
                      <strong>{heading}</strong>
                      <span>{total} plans</span>
                    </div>
                    {stages.map(([label, status, color]) => (
                      <Bar
                        key={`${key}-${status}`}
                        label={label}
                        value={counts[status] || 0}
                        max={Math.max(1, total)}
                        color={color}
                      />
                    ))}
                  </div>
                );
              })}
              {data.planning_pipeline.truncated && (
                <p className="spx-empty">
                  More than 5,000 plans were found in a category.
                  Displayed totals are incomplete.
                </p>
              )}
              {data.planning_pipeline.monthly_total === 0 &&
               data.planning_pipeline.weekly_total === 0 && (
                <p className="spx-empty">
                  No monthly or weekly planning records found
                  for the selected month.
                </p>
              )}
            </div>
          ) : (
            <p className="spx-empty">
              Planning pipeline information is not available.
            </p>
          )}
        </Panel>

<Panel
          title="Weekly Progress Trend"
          subtitle="Interactive planned versus completed activity trend"
        >
          {chart.trend.length ? (
            <WeeklyTrendChart trend={chart.trend}/>
          ) : (
            <p className="spx-empty">
              Weekly trend data is not available in the current API response.
              No estimated values are shown.
            </p>
          )}
        </Panel>
      </div>
      <p style={{fontSize:11,color:'#94a3b8',marginTop:12}}>
        Source: approved weekly Sprint plans. Charts update with the selected month. Unavailable figures are shown as —.
      </p>
    </div>
  );
}
