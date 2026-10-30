import { useCallback, useEffect, useState } from 'react';
import {
  Activity, ArrowUpRight, CheckCircle2, Clock3,
  AlertCircle, ListTodo, RefreshCw
} from 'lucide-react';
import { getSprintEmployeeMetrics } from '../api/sprintPlanning';

const monthNow = () => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
};

const safeNumber = (value) => {
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : 0;
};

const safeRate = (value) =>
  Math.min(100, Math.max(0, safeNumber(value)));

const extract = (response) => {
  const result = response?.data ?? response;
  return result?.counts ? result : result?.data ?? result;
};

const colors = {
  complete: '#16a34a',
  progress: '#f59e0b',
  incomplete: '#ef4444',
  pending: '#94a3b8',
  primary: '#2563eb'
};

function Count({ icon: Icon, label, value, color }) {
  return (
    <div style={{
      padding: '12px 14px',
      background: 'var(--surface-secondary, #f8fafc)',
      borderRadius: 11,
      minWidth: 0
    }}>
      <div style={{ display: 'flex', gap: 7, alignItems: 'center', color }}>
        <Icon size={15} />
        <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
      </div>
      <div style={{
        fontSize: 25, fontWeight: 750, marginTop: 7,
        color: 'var(--text-primary, inherit)'
      }}>
        {value}
      </div>
    </div>
  );
}

export default function SprintDashboardSummary({
  setPage,
  employeeId,
  compact = false
}) {
  const [month, setMonth] = useState(monthNow);
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const response = await getSprintEmployeeMetrics({
        month,
        ...(employeeId ? { employeeId } : {})
      });
      const result = extract(response);

      if (!result?.counts) {
        throw new Error('The metrics response is incomplete.');
      }

      setMetrics(result);
    } catch (err) {
      setMetrics(null);
      setError(err?.message || 'Unable to load Sprint Planning statistics.');
    } finally {
      setLoading(false);
    }
  }, [month, employeeId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const counts = metrics?.counts || {};
  const planned = safeNumber(counts.planned);
  const completed = safeNumber(counts.completed);
  const progress = safeNumber(counts.in_progress);
  const incomplete = safeNumber(counts.not_completed);
  const unreported = safeNumber(counts.unreported);

  const completionRate = safeRate(metrics?.completion_rate);
  const reportingRate = safeRate(metrics?.reporting_rate);

  return (
    <section className="card sprint-dashboard-summary"
      style={{ padding: 'clamp(15px, 2vw, 22px)', borderRadius: 14 }}>
      <style>{`
        @keyframes sprintSummaryAppear {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .sprint-dashboard-summary .sprint-summary-fill {
          transition: width .8s ease;
        }
        @media (prefers-reduced-motion: reduce) {
          .sprint-dashboard-summary * {
            animation: none !important;
            transition: none !important;
          }
        }
      `}</style>

      <header style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12,
        marginBottom: 17
      }}>
        <div>
          <h3 style={{
            display: 'flex', alignItems: 'center', gap: 9,
            margin: 0, fontSize: 18
          }}>
            <Activity size={20} />
            {employeeId ? 'Employee Sprint Progress' : 'My Sprint Progress'}
          </h3>
          <p style={{
            fontSize: 12, color: 'var(--text-muted, #64748b)',
            margin: '6px 0 0'
          }}>
            Based on approved weekly planning activities
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            aria-label="Sprint summary month"
            type="month"
            value={month}
            onChange={event => setMonth(event.target.value)}
            style={{
              maxWidth: 155, padding: '7px 9px', borderRadius: 8,
              border: '1px solid var(--border, #dbe1e8)',
              color: 'inherit',
              background: 'var(--surface, #fff)'
            }}
          />
          <button type="button" className="btn btn-secondary"
            aria-label="Refresh sprint summary"
            title="Refresh Sprint Summary"
            disabled={loading}
            onClick={refresh}>
            <RefreshCw size={15} />
          </button>
        </div>
      </header>

      {loading && (
        <p role="status" style={{ color: '#64748b' }}>
          Loading sprint progress...
        </p>
      )}

      {!loading && error && (
        <div role="alert">
          <p style={{ color: '#b91c1c', marginTop: 0 }}>{error}</p>
          <button type="button" className="btn btn-secondary"
            onClick={refresh}>Try Again</button>
        </div>
      )}

      {!loading && !error && metrics && (
        <div style={{ animation: 'sprintSummaryAppear .4s ease both' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))',
            gap: 9
          }}>
            <Count icon={ListTodo} label="Planned"
              value={planned} color={colors.primary} />
            <Count icon={CheckCircle2} label="Completed"
              value={completed} color={colors.complete} />
            <Count icon={Clock3} label="In Progress"
              value={progress} color={colors.progress} />
            <Count icon={AlertCircle} label="Incomplete"
              value={incomplete} color={colors.incomplete} />
            {!compact && (
              <Count icon={Activity} label="Unreported"
                value={unreported} color={colors.pending} />
            )}
          </div>

          <div style={{ marginTop: 19 }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              gap: 12, marginBottom: 8, fontSize: 13
            }}>
              <strong>Activity Completion</strong>
              <strong>{completionRate.toFixed(1)}%</strong>
            </div>

            <div role="progressbar"
              aria-label="Sprint activity completion"
              aria-valuemin={0} aria-valuemax={100}
              aria-valuenow={completionRate}
              style={{
                background: 'var(--surface-secondary, #e2e8f0)',
                borderRadius: 999, overflow: 'hidden', height: 12
              }}>
              <div className="sprint-summary-fill" style={{
                width: `${completionRate}%`,
                height: '100%',
                background: colors.complete,
                borderRadius: 999
              }} />
            </div>
          </div>

          <div style={{
            marginTop: 12, display: 'flex',
            justifyContent: 'space-between',
            gap: 12, flexWrap: 'wrap',
            fontSize: 12, color: 'var(--text-muted, #64748b)'
          }}>
            <span>Daily Reporting: {reportingRate.toFixed(1)}%</span>
            <span>Evidence Coverage: {safeRate(metrics.evidence_coverage_rate).toFixed(1)}%</span>
          </div>

          {planned === 0 && (
            <p style={{
              fontSize: 12, color: 'var(--text-muted, #64748b)',
              marginTop: 13
            }}>
              No activities in approved weekly plans for this month.
            </p>
          )}

          {typeof setPage === 'function' && (
            <button type="button" className="btn btn-secondary"
              style={{
                display: 'inline-flex',
                gap: 7, alignItems: 'center', marginTop: 17
              }}
              onClick={() => setPage('sprint_planning')}>
              View Sprint Planning
              <ArrowUpRight size={15} />
            </button>
          )}
        </div>
      )}
    </section>
  );
}