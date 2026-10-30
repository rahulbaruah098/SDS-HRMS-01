import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, BarChart3, CalendarDays, CheckCircle2,
  Clock3, AlertCircle, FileCheck2, RefreshCw,
  ListTodo, TrendingUp
} from 'lucide-react';
import { getSprintEmployeeMetrics } from '../api/sprintPlanning';

const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const number = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

const percentage = (value) => Math.min(100, Math.max(0, number(value)));

const unwrap = (response) => {
  const first = response?.data ?? response;
  return first?.data && !first?.counts ? first.data : first;
};

const formatDate = (date) => {
  if (!date) return '';
  const parts = String(date).split('-');
  return parts.length === 3 ? `${parts[2]}/${parts[1]}` : String(date);
};

const theme = {
  completed: '#16a34a',
  progress: '#f59e0b',
  incomplete: '#ef4444',
  unreported: '#94a3b8',
  primary: '#2563eb'
};

function MetricCard({ label, value, icon: Icon, color, detail }) {
  return (
    <div className="card" style={{
      padding: 19, borderRadius: 14, minWidth: 0,
      animation: 'sprintFade .45s ease both'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{
          width: 38, height: 38, display: 'grid', placeItems: 'center',
          background: `${color}16`, color, borderRadius: 11
        }}>
          <Icon size={20} />
        </span>
        <span style={{ fontSize: 13, color: 'var(--text-muted, #64748b)' }}>
          {label}
        </span>
      </div>
      <div style={{ fontSize: 30, fontWeight: 750, marginTop: 13 }}>
        {value}
      </div>
      {detail && <div style={{ fontSize: 12, color: 'var(--text-muted, #64748b)' }}>{detail}</div>}
    </div>
  );
}

function Ring({ value, label, color }) {
  const rate = percentage(value);
  const radius = 53;
  const circumference = 2 * Math.PI * radius;

  return (
    <div style={{ textAlign: 'center', flex: '1 1 150px' }}>
      <svg viewBox="0 0 150 150" style={{ width: '100%', maxWidth: 175 }}
        role="img" aria-label={`${label}: ${rate.toFixed(1)} percent`}>
        <circle cx="75" cy="75" r={radius} fill="none"
          stroke="currentColor" strokeOpacity=".09" strokeWidth="14" />
        <circle cx="75" cy="75" r={radius} fill="none"
          stroke={color} strokeWidth="14" strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - rate / 100)}
          transform="rotate(-90 75 75)"
          style={{ transition: 'stroke-dashoffset 900ms ease' }} />
        <text x="75" y="76" fontSize="24" fontWeight="750"
          fill="currentColor" textAnchor="middle" dominantBaseline="middle">
          {rate.toFixed(1)}%
        </text>
      </svg>
      <div style={{ fontSize: 13, fontWeight: 650, marginTop: 4 }}>{label}</div>
    </div>
  );
}

function DailyChart({ points }) {
  const days = Array.isArray(points) ? points : [];
  const width = 640;
  const height = 230;
  const left = 42;
  const right = 20;
  const top = 18;
  const bottom = 37;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maximum = Math.max(
    1, ...days.map(d => Math.max(number(d.planned), number(d.completed)))
  );

  const x = (i) => left + (days.length <= 1
    ? plotWidth / 2
    : i * plotWidth / (days.length - 1));
  const y = (value) => top + plotHeight * (1 - number(value) / maximum);

  const line = (key) => days.map((d, i) =>
    `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(d[key]).toFixed(1)}`
  ).join(' ');

  if (!days.length) {
    return <p style={{ color: '#64748b' }}>No daily activities recorded for this month.</p>;
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%"
        style={{ minWidth: 320, maxHeight: 340 }}
        role="img" aria-label="Daily planned and completed activity trend">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const yy = top + plotHeight * (1 - ratio);
          return (
            <g key={ratio}>
              <line x1={left} x2={width - right} y1={yy} y2={yy}
                stroke="currentColor" strokeOpacity=".10" />
              <text x={left - 9} y={yy + 4} fontSize="11" fill="currentColor"
                opacity=".6" textAnchor="end">
                {(maximum * ratio).toFixed(maximum < 4 ? 1 : 0)}
              </text>
            </g>
          );
        })}
        <path d={line('planned')} stroke={theme.primary}
          strokeWidth="3" fill="none" strokeLinecap="round"
          strokeLinejoin="round" style={{ animation: 'sprintFade .7s ease both' }} />
        <path d={line('completed')} stroke={theme.completed}
          strokeWidth="3" fill="none" strokeLinecap="round"
          strokeLinejoin="round" style={{ animation: 'sprintFade 1s ease both' }} />
        {days.map((d, i) => (
          <g key={`${d.date}-${i}`}>
            <circle cx={x(i)} cy={y(d.planned)} r="3.5" fill={theme.primary}>
              <title>{`${d.date}: ${number(d.planned)} planned`}</title>
            </circle>
            <circle cx={x(i)} cy={y(d.completed)} r="3.5" fill={theme.completed}>
              <title>{`${d.date}: ${number(d.completed)} completed`}</title>
            </circle>
          </g>
        ))}
        {days.filter((_, i) => (
          i === 0 || i === days.length - 1 ||
          i % Math.max(1, Math.ceil(days.length / 7)) === 0
        )).map(d => {
          const index = days.indexOf(d);
          return (
            <text key={`label-${index}`} x={x(index)} y={height - 12}
              fontSize="11" fill="currentColor" opacity=".7" textAnchor="middle">
              {formatDate(d.date)}
            </text>
          );
        })}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 20, fontSize: 12 }}>
        <span style={{ color: theme.primary }}>● Planned</span>
        <span style={{ color: theme.completed }}>● Completed</span>
      </div>
    </div>
  );
}

export default function SprintPerformanceDashboard({ employeeId }) {
  const [month, setMonth] = useState(currentMonth);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await getSprintEmployeeMetrics({ month, employeeId });
      const payload = unwrap(response);
      if (!payload || !payload.counts) {
        throw new Error('Performance metrics response is incomplete.');
      }
      setData(payload);
    } catch (err) {
      setData(null);
      setError(err?.message || 'Unable to load Sprint Planning performance.');
    } finally {
      setLoading(false);
    }
  }, [month, employeeId]);

  useEffect(() => { load(); }, [load]);

  const counts = data?.counts || {};
  const summary = useMemo(() => [
    { label: 'Planned', value: number(counts.planned), icon: ListTodo, color: theme.primary },
    { label: 'Completed', value: number(counts.completed), icon: CheckCircle2, color: theme.completed },
    { label: 'In Progress', value: number(counts.in_progress), icon: Clock3, color: theme.progress },
    { label: 'Not Completed', value: number(counts.not_completed), icon: AlertCircle, color: theme.incomplete },
    { label: 'Unreported', value: number(counts.unreported), icon: Activity, color: theme.unreported },
    { label: 'With Evidence', value: number(counts.completed_with_evidence), icon: FileCheck2, color: theme.completed }
  ], [counts.planned, counts.completed, counts.in_progress,
    counts.not_completed, counts.unreported, counts.completed_with_evidence]);

  const total = number(counts.planned);
  const statusSegments = [
    { label: 'Completed', count: number(counts.completed), color: theme.completed },
    { label: 'In Progress', count: number(counts.in_progress), color: theme.progress },
    { label: 'Not Completed', count: number(counts.not_completed), color: theme.incomplete },
    { label: 'Unreported', count: number(counts.unreported), color: theme.unreported }
  ];

  return (
    <section className="sprint-performance-dashboard"
      style={{ padding: 'clamp(12px, 2vw, 24px)', maxWidth: 1350, margin: '0 auto' }}>
      <style>{`
        @keyframes sprintFade {
          from { opacity: 0; transform: translateY(7px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .sprint-performance-dashboard * { animation: none !important; transition: none !important; }
        }
      `}</style>

      <header style={{
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', flexWrap: 'wrap', gap: 14, marginBottom: 22
      }}>
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 9, margin: 0 }}>
            <TrendingUp size={24} /> {employeeId ? 'Employee Sprint Performance' : 'My Sprint Performance'}
          </h2>
          <p style={{ color: 'var(--text-muted, #64748b)', marginBottom: 0 }}>
            Performance from approved weekly plans and recorded daily activities.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
          <CalendarDays size={18} />
          <input type="month" value={month} aria-label="Performance month"
            onChange={e => setMonth(e.target.value)}
            style={{ border: '1px solid var(--border, #dbe1e8)',
              background: 'var(--surface, #fff)', color: 'inherit',
              borderRadius: 8, padding: '9px 11px' }} />
          <button type="button" className="btn btn-secondary" onClick={load}
            disabled={loading}><RefreshCw size={16} /> Refresh</button>
        </div>
      </header>

      {loading && <div className="card" style={{ padding: 24 }}>Loading performance metrics...</div>}

      {!loading && error && (
        <div className="card" role="alert" style={{ padding: 22 }}>
          <strong>Unable to load performance data</strong>
          <p>{error}</p>
          <button type="button" className="btn btn-secondary" onClick={load}>Try Again</button>
        </div>
      )}

      {!loading && !error && data && (
        <>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(155px,1fr))',
            gap: 12, marginBottom: 18
          }}>
            {summary.map(item => <MetricCard key={item.label} {...item} />)}
          </div>

          {total === 0 && (
            <div className="card" style={{ padding: 17, marginBottom: 18 }}>
              No activities found in approved weekly plans for this month.
              Draft and pending plans are not included in these completion figures.
            </div>
          )}

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,340px),1fr))',
            gap: 16, marginBottom: 18
          }}>
            <div className="card" style={{ padding: 20, borderRadius: 14 }}>
              <h3 style={{ marginTop: 0, fontSize: 17 }}>Performance Rates</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
                <Ring label="Completion" value={data.completion_rate} color={theme.completed} />
                <Ring label="Daily Reporting" value={data.reporting_rate} color={theme.primary} />
                <Ring label="Evidence Coverage" value={data.evidence_coverage_rate} color={theme.progress} />
              </div>
            </div>

            <div className="card" style={{ padding: 20, borderRadius: 14 }}>
              <h3 style={{ marginTop: 0, fontSize: 17 }}>Work Status Distribution</h3>
              <div style={{
                display: 'flex', height: 18, overflow: 'hidden',
                borderRadius: 999, background: '#e2e8f0', marginTop: 25
              }}>
                {statusSegments.map(segment => (
                  <div key={segment.label}
                    title={`${segment.label}: ${segment.count}`}
                    style={{
                      width: `${total ? segment.count / total * 100 : 0}%`,
                      background: segment.color,
                      transition: 'width 900ms ease'
                    }} />
                ))}
              </div>
              <div style={{ display: 'grid', gap: 12, marginTop: 22 }}>
                {statusSegments.map(segment => (
                  <div key={segment.label} style={{
                    display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between', gap: 10
                  }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                      <span style={{
                        width: 10, height: 10, borderRadius: 4,
                        background: segment.color, display: 'inline-block'
                      }} />
                      {segment.label}
                    </span>
                    <strong>{segment.count}</strong>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 20, borderRadius: 14 }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 0, fontSize: 17 }}>
              <BarChart3 size={20} /> Daily Activity Trend
            </h3>
            <DailyChart points={data.daily_trend} />
          </div>

          <p style={{ fontSize: 12, color: 'var(--text-muted, #64748b)', marginTop: 14 }}>
            Data covers approved weekly plans only. Evidence coverage indicates a submitted
            evidence reference, not independent verification of work quality.
            {data.evidence_note ? ` ${data.evidence_note}` : ''}
          </p>
        </>
      )}
    </section>
  );
}