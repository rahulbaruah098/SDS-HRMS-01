import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Users, TrendingUp, CheckCircle2, Clock3,
  AlertCircle, FileCheck2, RefreshCw, Search,
  ArrowLeft, BarChart3, CalendarDays, ShieldAlert
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
  primary: '#2563eb',
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

export default function SprintTeamDashboard() {
  const [month, setMonth] = useState(currentMonth);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('all');
  const [selectedEmployee, setSelectedEmployee] = useState(null);


  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await getSprintTeamMetrics({ month });
      const payload = unwrap(response);

      if (!payload || !Array.isArray(payload.employees) || !payload.summary) {
        throw new Error('Team performance response is incomplete.');
      }

      setResult(payload);
    } catch (err) {
      setResult(null);
      setError(err?.message || 'Unable to retrieve team performance.');
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    load();
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
    }).sort((a, b) =>
      rate(b.completion_rate) - rate(a.completion_rate)
    );
  }, [employees, search, department]);

  const summary = result?.summary || {};
  const isTruncated = result?.truncated === true;

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
          : 0
      }))
      .sort((a, b) => b.completion_rate - a.completion_rate);
  }, [employees]);

  return (
    <main className="sprint-team-dashboard"
      style={{ maxWidth: 1450, minWidth: 0, margin: '0 auto', padding: 'clamp(12px,2vw,24px)', color: 'var(--text, inherit)' }}>
      <style>{`
        .sprint-team-dashboard { --sprint-primary: var(--primary, var(--color-primary, #2563eb)); }
        .sprint-team-dashboard .card { min-width: 0; background: var(--surface, var(--card-bg, #fff)); border-color: var(--border, #e2e8f0); }
        .sprint-team-dashboard .sprint-team-header { min-width: 0; }
        .sprint-team-dashboard .sprint-team-title { font-size: clamp(1.22rem, 2.5vw, 1.65rem); line-height: 1.25; }
        .sprint-team-dashboard .sprint-team-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 9px; min-width: 0; }
        .sprint-team-dashboard .sprint-team-control { min-height: 44px; max-width: 100%; }
        .sprint-team-dashboard button { min-height: 42px; }
        .sprint-team-dashboard button:focus-visible,
        .sprint-team-dashboard input:focus-visible,
        .sprint-team-dashboard select:focus-visible { outline: 2px solid var(--sprint-primary); outline-offset: 2px; }
        .sprint-team-dashboard .sprint-team-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 160px), 1fr)); gap: 12px; margin-bottom: 18px; }
        .sprint-team-dashboard .sprint-team-panels { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: 16px; margin-bottom: 18px; }
        .sprint-team-dashboard .sprint-team-filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); gap: 12px; margin-bottom: 18px; }
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
            key={selectedEmployee.employee_id}
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
            <div className="card" role="status" style={{ padding: 24 }}>
              Loading team performance...
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

              <div className="sprint-team-panels">
                <section className="card" style={{ padding: 20 }}>
                  <h3 style={{ marginTop: 0, fontSize: 17 }}>
                    Overall Completion
                  </h3>
                  <div style={{ fontSize: 32, fontWeight: 750, marginBottom: 12 }}>
                    {rate(summary.completion_rate).toFixed(1)}%
                  </div>
                  <ProgressBar value={summary.completion_rate} />
                  <p style={{ fontSize: 12, color: 'var(--text-muted, #64748b)' }}>
                    Reporting compliance: {rate(summary.reporting_rate).toFixed(1)}%
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--text-muted, #64748b)' }}>
                    Evidence coverage: {rate(summary.evidence_coverage_rate).toFixed(1)}%
                  </p>
                </section>

                <section className="card" style={{ padding: 20 }}>
                  <h3 style={{ marginTop: 0, fontSize: 17 }}>
                    Department Comparison
                  </h3>
                  {departmentStats.length === 0 ? (
                    <p style={{ color: 'var(--text-muted, #64748b)', fontSize: 13 }}>
                      No department data available.
                    </p>
                  ) : departmentStats.map(item => (
                    <div key={item.name} style={{ marginBottom: 13 }}>
                      <div style={{
                        display: 'flex', justifyContent: 'space-between',
                        gap: 10, fontSize: 13, marginBottom: 7
                      }}>
                        <span>{item.name} ({item.employees})</span>
                        <strong>{rate(item.completion_rate).toFixed(1)}%</strong>
                      </div>
                      <ProgressBar value={item.completion_rate} color={'var(--sprint-primary)'} />
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
                </div>

                {filtered.length === 0 ? (
                  <p style={{ color: 'var(--text-muted, #64748b)' }}>
                    No employees match the selected filters.
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
                          <strong>{rate(employee.completion_rate).toFixed(1)}%</strong>
                        </div>
                        <div className="sprint-team-employee-meta" style={{
                          marginTop: 11, fontSize: 12, color: 'var(--text-muted, #64748b)'
                        }}>
                          <span>Completed: {number(employee.completed)}/{number(employee.planned)}</span>
                          <span>Reporting: {rate(employee.reporting_rate).toFixed(1)}%</span>
                          <span>Evidence: {rate(employee.evidence_coverage_rate).toFixed(1)}%</span>
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
                Evidence coverage measures submitted evidence references,
                not independent verification of work quality.
              </p>
            </>
          )}
        </>
      )}
    </main>
  );
}