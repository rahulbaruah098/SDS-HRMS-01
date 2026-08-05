import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  RefreshCcw,
  Send,
  Sparkles,
  Star,
  TrendingUp,
  UsersRound,
} from 'lucide-react';
import {
  currentEmployee,
  currentUser,
  getPerformanceDashboard,
  getPerformanceReviews,
  submitWeeklyPerformanceReview,
} from '../api/client';

const EMPTY_FORM = {
  employee_id: '',
  rating: '5',
  remarks: '',
  strengths: '',
  improvement_areas: '',
};

function normalizeRole(role = '') {
  return String(role || '').trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
}

function isTruthy(value) {
  return ['true', 'yes', '1', 'on', '1.0'].includes(
    String(value || '').trim().toLowerCase(),
  );
}

function isMongoObjectId(value = '') {
  return /^[a-f\d]{24}$/i.test(String(value || '').trim());
}

function getRoles(user = {}, employee = {}, capabilities = {}) {
  const rawRoles = [];

  if (Array.isArray(user.roles)) rawRoles.push(...user.roles);
  if (user.role) rawRoles.push(user.role);
  if (Array.isArray(employee.roles)) rawRoles.push(...employee.roles);
  if (employee.role) rawRoles.push(employee.role);
  if (Array.isArray(capabilities.roles)) rawRoles.push(...capabilities.roles);
  if (capabilities.role) rawRoles.push(capabilities.role);

  const hasTeamLeaderCapability =
    isTruthy(user.is_team_leader) ||
    user.is_team_leader === true ||
    isTruthy(user.team_leader_capability) ||
    user.team_leader_capability === true ||
    isTruthy(user.tl_capability) ||
    user.tl_capability === true ||
    isTruthy(employee.is_team_leader) ||
    employee.is_team_leader === true ||
    isTruthy(employee.team_leader_capability) ||
    employee.team_leader_capability === true ||
    isTruthy(employee.tl_capability) ||
    employee.tl_capability === true ||
    isTruthy(capabilities.is_team_leader) ||
    capabilities.is_team_leader === true ||
    isTruthy(capabilities.team_leader_capability) ||
    capabilities.team_leader_capability === true ||
    isTruthy(capabilities.tl_capability) ||
    capabilities.tl_capability === true;

  const hasReportingOfficerCapability =
    isTruthy(user.is_reporting_officer) ||
    user.is_reporting_officer === true ||
    isTruthy(user.reporting_officer_capability) ||
    user.reporting_officer_capability === true ||
    isTruthy(user.ro_capability) ||
    user.ro_capability === true ||
    isTruthy(employee.is_reporting_officer) ||
    employee.is_reporting_officer === true ||
    isTruthy(employee.reporting_officer_capability) ||
    employee.reporting_officer_capability === true ||
    isTruthy(employee.ro_capability) ||
    employee.ro_capability === true ||
    isTruthy(capabilities.is_reporting_officer) ||
    capabilities.is_reporting_officer === true ||
    isTruthy(capabilities.reporting_officer_capability) ||
    capabilities.reporting_officer_capability === true ||
    isTruthy(capabilities.ro_capability) ||
    capabilities.ro_capability === true;

  if (hasTeamLeaderCapability) {
    rawRoles.push('team_leader');
  }

  if (hasReportingOfficerCapability) {
    rawRoles.push('reporting_officer');
    rawRoles.push('ro');
  }

  return [...new Set(rawRoles.map(normalizeRole).filter(Boolean))];
}

function getEmployeeDbId(item = {}) {
  const candidates = [
    item._id,
    item.id,
    item.employee_db_id,
    item.employee_object_id,
    item.employee_mongo_id,
    item.target_employee_id,
  ];

  const mongoId = candidates.find((value) => isMongoObjectId(value));

  if (mongoId) {
    return String(mongoId).trim();
  }

  const fallback = candidates.find((value) => String(value || '').trim());

  return String(fallback || '').trim();
}

function getEmployeeCode(item = {}) {
  return String(
    item.employee_code ||
      item.emp_code ||
      item.code ||
      (!isMongoObjectId(item.employee_id) ? item.employee_id : '') ||
      '',
  ).trim();
}

function getEmployeeId(item = {}) {
  return getEmployeeDbId(item);
}

function getEmployeeName(item = {}) {
  return (
    item.employee_name ||
    item.name ||
    item.display_name ||
    item.full_name ||
    item.email ||
    'Employee'
  );
}

function formatRating(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toFixed(1) : '0.0';
}

function ratingLabel(value) {
  const rating = Number(value || 0);

  if (rating >= 4.5) return 'Excellent';
  if (rating >= 3.5) return 'Good';
  if (rating >= 2.5) return 'Average';
  if (rating > 0) return 'Needs Improvement';
  return 'Not Rated';
}

function percentFromRating(value) {
  const rating = Number(value || 0);
  if (!Number.isFinite(rating)) return 0;
  return Math.max(0, Math.min(100, (rating / 5) * 100));
}

function formatDate(value) {
  if (!value) return '—';

  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return String(value);
  }
}

function buildUniqueReviewableEmployees(teamMembers = [], reportingMembers = [], mode = '') {
  const map = new Map();

  if (mode === 'team_leader') {
    teamMembers.forEach((item) => {
      const id = getEmployeeId(item);
      if (!id) return;

      map.set(id, {
        ...item,
        employee_id: id,
        target_employee_id: id,
        employee_db_id: id,
        employee_code: getEmployeeCode(item),
        raw_employee_id: item.employee_id,
        employee_name: getEmployeeName(item),
        review_target_type: 'team_member',
        review_scope_label: 'Team Member',
      });
    });
  }

  if (mode === 'reporting_officer') {
    reportingMembers.forEach((item) => {
      const id = getEmployeeId(item);
      if (!id) return;

      const isTeamLeader =
        isTruthy(item.is_team_leader) ||
        item.is_team_leader === true ||
        normalizeRole(item.role) === 'team_leader' ||
        String(item.relation || '').includes('team_leader');

      map.set(id, {
        ...item,
        employee_id: id,
        target_employee_id: id,
        employee_db_id: id,
        employee_code: getEmployeeCode(item),
        raw_employee_id: item.employee_id,
        employee_name: getEmployeeName(item),
        review_target_type: isTeamLeader ? 'team_leader' : 'reporting_member',
        review_scope_label: isTeamLeader ? 'Team Leader' : 'Reporting Member',
      });
    });
  }

  return [...map.values()].sort((a, b) =>
    getEmployeeName(a).localeCompare(getEmployeeName(b)),
  );
}

function arrayFromDashboard(...values) {
  for (const value of values) {
    if (Array.isArray(value)) {
      return value.filter(Boolean);
    }
  }

  return [];
}

function mergeDashboardEmployees(...lists) {
  const map = new Map();

  lists.flat().filter(Boolean).forEach((item, index) => {
    const id =
      getEmployeeDbId(item) ||
      item.employee_id ||
      item.employee_code ||
      item.emp_code ||
      item.email ||
      `employee-${index}`;

    if (!id) return;

    if (!map.has(String(id))) {
      map.set(String(id), item);
    }
  });

  return [...map.values()];
}

function StatCard({ label, value, meta, icon = null }) {
  return (
    <div className="performance-stat-card">
      {icon ? <div className="performance-stat-icon">{icon}</div> : null}
      <span>{label}</span>
      <strong>{value}</strong>
      {meta ? <small>{meta}</small> : null}
    </div>
  );
}

function EmptyState({
  title = 'No data available',
  text = 'Data will appear here after reviews are submitted.',
}) {
  return (
    <div className="performance-empty">
      <div className="performance-empty-icon"><BarChart3 size={26} /></div>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

function getGraphRows(chart) {
  if (Array.isArray(chart)) {
    return chart.filter(Boolean);
  }

  if (!chart || typeof chart !== 'object') {
    return [];
  }

  const merged = [
    ...(Array.isArray(chart.members) ? chart.members : []),
    ...(Array.isArray(chart.rows) ? chart.rows : []),
    ...(Array.isArray(chart.items) ? chart.items : []),
    ...(Array.isArray(chart.recent_reviews) ? chart.recent_reviews : []),
    ...(Array.isArray(chart.rating_distribution) ? chart.rating_distribution : []),
  ].filter(Boolean);

  const unique = new Map();

  merged.forEach((item, index) => {
    const key =
      item.employee_id ||
      item.target_employee_id ||
      item.reviewer_employee_id ||
      item.graph_label ||
      item.employee_name ||
      item.target_employee_name ||
      item.name ||
      item.cycle ||
      item.week_label ||
      `row-${index}`;

    unique.set(`${key}-${index}`, item);
  });

  return [...unique.values()];
}

function hasGraphData(chart) {
  return getGraphRows(chart).length > 0;
}

function pickGraphSource(...sources) {
  return sources.find((source) => hasGraphData(source)) || [];
}

function getGraphRating(item = {}) {
  return Number(
    item.average_rating ??
      item.avg_rating ??
      item.rating_average ??
      item.rating_value ??
      item.latest_rating ??
      item.rating ??
      item.score ??
      item.performance_score ??
      item.value ??
      0,
  );
}

function getGraphPercent(item = {}) {
  const rating = getGraphRating(item);
  const rawPercent = Number(
    item.rating_percentage ??
      item.rating_percent ??
      item.graph_value ??
      item.percentage ??
      item.percent ??
      0,
  );

  if (Number.isFinite(rawPercent) && rawPercent > 0) {
    return Math.max(0, Math.min(100, rawPercent));
  }

  if (Number.isFinite(rating) && rating > 0) {
    return Math.max(0, Math.min(100, (rating / 5) * 100));
  }

  return 0;
}

function PerformanceGraph({ title, subtitle, chart }) {
  const graphRows = getGraphRows(chart);

  return (
    <section className="performance-panel performance-graph-panel">
      <div className="performance-section-head">
        <div>
          <span className="performance-kicker">3D Performance Graph</span>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </div>

      {!graphRows.length ? (
        <EmptyState
          title="No graph data yet"
          text="Submit a weekly performance rating first. The 3D graph will appear immediately after saving."
        />
      ) : (
        <div className="performance-3d-chart">
          {graphRows.slice(0, 12).map((item, index) => {
            const name =
              item.graph_label ||
              item.employee_name ||
              item.target_employee_name ||
              item.team_leader_name ||
              item.reviewer_name ||
              item.name ||
              item.cycle ||
              item.week_label ||
              `Employee ${index + 1}`;

            const rating = getGraphRating(item);
            const percentage = getGraphPercent(item);

            return (
              <div className="performance-3d-row" key={`${name}-${index}`}>
                <div className="performance-3d-label">
                  <strong>{name}</strong>
                  <span>{ratingLabel(rating)}</span>
                </div>

                <div className="performance-3d-track">
                  <div
                    className="performance-3d-bar"
                    style={{ width: `${Math.max(8, Math.min(100, percentage))}%` }}
                  >
                    <span>{formatRating(rating)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ReviewHistory({ title, reviews }) {
  const rows = Array.isArray(reviews) ? reviews : [];

  return (
    <section className="performance-panel">
      <div className="performance-section-head">
        <div>
          <span className="performance-kicker">Review History</span>
          <h2>{title}</h2>
        </div>
      </div>

      {!rows.length ? (
        <EmptyState title="No reviews yet" text="Submitted and received reviews will appear here." />
      ) : (
        <div className="performance-table-wrap">
          <table className="performance-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Reviewer</th>
                <th>Rating</th>
                <th>Period</th>
                <th>Remarks</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 20).map((item, index) => {
                const rating = item.rating_value || item.rating || item.score || item.performance_score || 0;

                return (
                  <tr key={item._id || `${item.employee_id}-${index}`}>
                    <td>
                      <strong>{item.employee_name || item.target_employee_name || 'Employee'}</strong>
                      <span>{item.review_scope_label || item.review_target_type || 'Performance Review'}</span>
                    </td>
                    <td>{item.reviewer_name || item.reviewer_employee_name || '—'}</td>
                    <td>
                      <span className="performance-rating-pill">
                        {formatRating(rating)} / 5
                      </span>
                    </td>
                    <td>{item.week_label || item.month_label || item.year_label || item.cycle || 'Weekly'}</td>
                    <td>{item.remarks || item.comments || item.note || '—'}</td>
                    <td>{formatDate(item.review_date || item.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function Performance({ setPage }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dashboard, setDashboard] = useState({});
  const [reviewHistory, setReviewHistory] = useState([]);
  const [activeMode, setActiveMode] = useState('team_leader');
  const [graphMode, setGraphMode] = useState('weekly');
  const [form, setForm] = useState(EMPTY_FORM);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const user = currentUser();
  const employee = currentEmployee();

  const sessionRoles = useMemo(() => getRoles(user, employee), [user, employee]);

  const dashboardEmployee = dashboard.employee || dashboard.employee_summary || {};
  const dashboardCapabilities = dashboard.capabilities || {};

  const dashboardRoles = useMemo(
    () =>
      getRoles(
        {
          ...(dashboard.user || dashboard.current_user || {}),
          roles: Array.isArray(dashboard.roles) ? dashboard.roles : [],
          role: dashboard.role || '',
        },
        dashboardEmployee,
        dashboardCapabilities,
      ),
    [dashboard.user, dashboard.current_user, dashboard.roles, dashboard.role, dashboardEmployee, dashboardCapabilities],
  );

  const roles = useMemo(
    () => [...new Set([...sessionRoles, ...dashboardRoles].map(normalizeRole).filter(Boolean))],
    [sessionRoles, dashboardRoles],
  );

  const isTeamLeader =
    roles.includes('team_leader') ||
    isTruthy(employee?.is_team_leader) ||
    employee?.is_team_leader === true ||
    isTruthy(dashboardEmployee?.is_team_leader) ||
    dashboardEmployee?.is_team_leader === true ||
    isTruthy(dashboardCapabilities?.is_team_leader) ||
    dashboardCapabilities?.is_team_leader === true;

  const isReportingOfficer =
    roles.includes('reporting_officer') ||
    roles.includes('ro') ||
    roles.includes('manager') ||
    isTruthy(employee?.is_reporting_officer) ||
    employee?.is_reporting_officer === true ||
    isTruthy(dashboardEmployee?.is_reporting_officer) ||
    dashboardEmployee?.is_reporting_officer === true ||
    isTruthy(dashboardCapabilities?.is_reporting_officer) ||
    dashboardCapabilities?.is_reporting_officer === true;

  const canAccess = isTeamLeader || isReportingOfficer;

  const teamMembers = useMemo(
    () =>
      mergeDashboardEmployees(
        arrayFromDashboard(dashboard.team_members),
        arrayFromDashboard(dashboard.team_member_employees),
        arrayFromDashboard(dashboard.team_scope_members),
        arrayFromDashboard(dashboard.mapped_team_members),
        arrayFromDashboard(dashboard.performance_dashboard?.team_members),
      ),
    [dashboard],
  );

  const reportingMembers = useMemo(
    () =>
      mergeDashboardEmployees(
        arrayFromDashboard(dashboard.reporting_members),
        arrayFromDashboard(dashboard.reporting_scope_members),
        arrayFromDashboard(dashboard.reporting_employees),
        arrayFromDashboard(dashboard.mapped_reporting_members),
        arrayFromDashboard(dashboard.performance_dashboard?.reporting_members),
      ),
    [dashboard],
  );

  const reviewableEmployees = useMemo(
    () =>
      buildUniqueReviewableEmployees(
        teamMembers,
        reportingMembers,
        activeMode,
      ),
    [teamMembers, reportingMembers, activeMode],
  );

  const selectedEmployee = useMemo(
    () => reviewableEmployees.find((item) => String(item.employee_id) === String(form.employee_id)),
    [reviewableEmployees, form.employee_id],
  );

  const myReviews = Array.isArray(dashboard.my_reviews)
    ? dashboard.my_reviews
    : Array.isArray(dashboard.my_performance_reviews)
      ? dashboard.my_performance_reviews
      : [];

  const reviewsGiven = Array.isArray(dashboard.reviews_given)
    ? dashboard.reviews_given
    : Array.isArray(dashboard.reviews_given_by_me)
      ? dashboard.reviews_given_by_me
      : [];

  const selectedGraph = useMemo(() => {
    if (graphMode === 'monthly') {
      return pickGraphSource(
        dashboard.monthly_performance_chart,
        dashboard.reporting_performance_chart?.monthly_3d_graph,
        dashboard.team_performance_chart?.monthly_3d_graph,
        dashboard.my_performance_chart?.monthly_3d_graph,
        dashboard.performance_3d_graph,
        dashboard.reporting_team_leader_weekly_graph,
        dashboard.team_member_weekly_graph,
        reviewHistory,
      );
    }

    if (graphMode === 'yearly') {
      return pickGraphSource(
        dashboard.yearly_performance_chart,
        dashboard.reporting_performance_chart?.yearly_3d_graph,
        dashboard.team_performance_chart?.yearly_3d_graph,
        dashboard.my_performance_chart?.yearly_3d_graph,
        dashboard.performance_3d_graph,
        dashboard.reporting_team_leader_weekly_graph,
        dashboard.team_member_weekly_graph,
        reviewHistory,
      );
    }

    return pickGraphSource(
      dashboard.performance_3d_graph,
      dashboard.reporting_team_leader_weekly_graph,
      dashboard.team_member_weekly_graph,
      dashboard.reporting_performance_chart,
      dashboard.team_performance_chart,
      dashboard.my_performance_chart,
      dashboard.weekly_performance_chart,
      reviewHistory,
    );
  }, [dashboard, graphMode, reviewHistory]);

  const dashboardSummary =
    dashboard.performance_summary ||
    dashboard.my_performance_chart?.summary ||
    {};

  const stats = {
    averageRating:
      dashboardSummary.average_rating ||
      dashboardSummary.my_average_rating ||
      dashboardSummary.average_rating_received ||
      dashboard.my_performance_chart?.summary?.average_rating ||
      0,
    reviewsReceived:
      dashboardSummary.total_reviews ||
      dashboardSummary.reviews_received ||
      myReviews.length ||
      0,
    reviewsGiven:
      dashboardSummary.reviews_given ||
      reviewsGiven.length ||
      0,
    reviewable: reviewableEmployees.length,
  };

  async function loadData(options = {}) {
    const keepMessage = Boolean(options.keepMessage);

    setLoading(true);
    setError('');
    if (!keepMessage) {
      setMessage('');
    }

    try {
      const [dashboardData, historyData] = await Promise.all([
        getPerformanceDashboard(),
        getPerformanceReviews({
          limit: 100,
          sort_by: 'created_at',
          sort_dir: 'desc',
        }),
      ]);

      setDashboard(dashboardData || {});
      setReviewHistory(Array.isArray(historyData?.items) ? historyData.items : []);

      const dashboardDataEmployee =
        dashboardData?.employee || dashboardData?.employee_summary || {};
      const dashboardDataCapabilities = dashboardData?.capabilities || {};

      const dashboardDataRoles = getRoles(
        {
          ...(dashboardData?.user || dashboardData?.current_user || {}),
          roles: Array.isArray(dashboardData?.roles) ? dashboardData.roles : [],
          role: dashboardData?.role || '',
        },
        dashboardDataEmployee,
        dashboardDataCapabilities,
      );

      const dataIsTeamLeader =
        dashboardDataRoles.includes('team_leader') ||
        isTruthy(dashboardDataEmployee?.is_team_leader) ||
        dashboardDataEmployee?.is_team_leader === true ||
        isTruthy(dashboardDataCapabilities?.is_team_leader) ||
        dashboardDataCapabilities?.is_team_leader === true ||
        isTeamLeader;

      const dataIsReportingOfficer =
        dashboardDataRoles.includes('reporting_officer') ||
        dashboardDataRoles.includes('ro') ||
        dashboardDataRoles.includes('manager') ||
        isTruthy(dashboardDataEmployee?.is_reporting_officer) ||
        dashboardDataEmployee?.is_reporting_officer === true ||
        isTruthy(dashboardDataCapabilities?.is_reporting_officer) ||
        dashboardDataCapabilities?.is_reporting_officer === true ||
        isReportingOfficer;

      const availableModes = [];
      if (dataIsTeamLeader) availableModes.push('team_leader');
      if (dataIsReportingOfficer) availableModes.push('reporting_officer');

      const defaultMode = availableModes.includes(activeMode)
        ? activeMode
        : availableModes[0] || 'team_leader';

      setActiveMode(defaultMode);

      const defaultReviewable = buildUniqueReviewableEmployees(
        mergeDashboardEmployees(
          arrayFromDashboard(dashboardData?.team_members),
          arrayFromDashboard(dashboardData?.team_member_employees),
          arrayFromDashboard(dashboardData?.team_scope_members),
          arrayFromDashboard(dashboardData?.mapped_team_members),
          arrayFromDashboard(dashboardData?.performance_dashboard?.team_members),
        ),
        mergeDashboardEmployees(
          arrayFromDashboard(dashboardData?.reporting_members),
          arrayFromDashboard(dashboardData?.reporting_scope_members),
          arrayFromDashboard(dashboardData?.reporting_employees),
          arrayFromDashboard(dashboardData?.mapped_reporting_members),
          arrayFromDashboard(dashboardData?.performance_dashboard?.reporting_members),
        ),
        defaultMode,
      );

      setForm((prev) => {
        const existingStillValid = defaultReviewable.some(
          (item) => String(item.employee_id) === String(prev.employee_id),
        );

        return {
          ...prev,
          employee_id: existingStillValid
            ? prev.employee_id
            : defaultReviewable[0]?.employee_id || '',
        };
      });
    } catch (err) {
      setError(err.message || 'Unable to load performance dashboard.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!reviewableEmployees.length) {
      setForm((prev) => ({ ...prev, employee_id: '' }));
      return;
    }

    const stillExists = reviewableEmployees.some((item) => String(item.employee_id) === String(form.employee_id));

    if (!stillExists) {
      setForm((prev) => ({
        ...prev,
        employee_id: reviewableEmployees[0]?.employee_id || '',
      }));
    }
  }, [activeMode, reviewableEmployees, form.employee_id]);

  function updateForm(key, value) {
    setForm((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    setError('');
    setMessage('');

    if (!selectedEmployee) {
      setError('Please select an employee to review.');
      return;
    }

    const targetEmployeeId =
      selectedEmployee.employee_db_id ||
      selectedEmployee.target_employee_id ||
      selectedEmployee.employee_id;

    if (!targetEmployeeId) {
      setError('Selected employee record is missing a valid database ID.');
      return;
    }

    const rating = Number(form.rating);

    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      setError('Rating must be between 1 and 5.');
      return;
    }

    setSaving(true);

    try {
      const payload = {
        employee_id: targetEmployeeId,
        target_employee_id: targetEmployeeId,
        target_employee_name: selectedEmployee.employee_name,
        employee_code: selectedEmployee.employee_code || selectedEmployee.raw_employee_id || '',

        review_target_type: selectedEmployee.review_target_type,
        review_scope_label: selectedEmployee.review_scope_label,

        rating,
        rating_value: rating,
        score: rating,
        performance_score: rating,

        remarks: form.remarks,
        comments: form.remarks,
        strengths: form.strengths,
        improvement_areas: form.improvement_areas,

        period_type: 'weekly',
        review_frequency: 'weekly',
      };

      const response = await submitWeeklyPerformanceReview(payload);

      setMessage(response.message || 'Weekly performance review submitted successfully.');
      setForm((prev) => ({
        ...EMPTY_FORM,
        employee_id: prev.employee_id,
      }));

      await loadData({ keepMessage: true });
      setGraphMode('weekly');
    } catch (err) {
      setError(err.message || 'Unable to submit performance review.');
    } finally {
      setSaving(false);
    }
  }

  if (!loading && !canAccess) {
    return (
      <main className="performance-page">

      <style>{`
        .performance-page {
          --pf-ink: #101a3a;
          --pf-copy: #5d6d8d;
          --pf-violet: #6658dc;
          --pf-blue: #3766db;
          --pf-cyan: #18b5c8;
          --pf-teal: #34c9c4;
          --pf-line: rgba(16, 26, 58, .14);
          display: grid;
          gap: clamp(18px, 2vw, 26px);
          min-width: 0;
          color: var(--pf-ink);
        }

        .performance-page * {
          box-sizing: border-box;
        }

        .performance-hero {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: center;
          gap: clamp(22px, 3vw, 40px);
          min-height: 275px;
          padding: clamp(25px, 3vw, 42px);
          border: 1px solid rgba(154, 164, 205, .58);
          border-radius: clamp(28px, 2.7vw, 40px);
          background:
            radial-gradient(circle at 8% 6%, rgba(105, 217, 208, .26), transparent 29%),
            radial-gradient(circle at 95% 4%, rgba(153, 164, 245, .24), transparent 31%),
            linear-gradient(135deg, #eef9ff 0%, #f8f3ff 52%, #effbf8 100%);
          box-shadow:
            12px 14px 0 #c6d8f7,
            0 28px 48px rgba(34, 38, 110, .13);
        }

        .performance-hero::before {
          content: "";
          position: absolute;
          z-index: -1;
          width: 175px;
          height: 175px;
          right: 8%;
          bottom: -98px;
          border-radius: 38% 62% 58% 42% / 48% 43% 57% 52%;
          background: linear-gradient(145deg, rgba(105,217,208,.30), rgba(132,181,241,.28));
          transform: rotate(-18deg);
        }

        .performance-kicker {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          width: max-content;
          max-width: 100%;
          margin-bottom: 13px;
          padding: 8px 12px;
          border-radius: 999px;
          color: #fff;
          background: #342b78;
          box-shadow: 4px 5px 0 #18b5c8;
          font-size: 9px;
          font-weight: 950;
          line-height: 1;
          letter-spacing: .11em;
          text-transform: uppercase;
        }

        .performance-hero h1 {
          max-width: 900px;
          margin: 0;
          color: var(--pf-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(44px, 5.2vw, 77px);
          font-weight: 760;
          line-height: .94;
          letter-spacing: -.058em;
        }

        .performance-hero h1 em {
          color: var(--pf-violet);
          font-family: Georgia, "Times New Roman", serif;
          font-weight: 500;
        }

        .performance-hero p {
          max-width: 840px;
          margin: 17px 0 0;
          color: var(--pf-copy);
          font-size: clamp(13px, 1vw, 16px);
          line-height: 1.68;
        }

        .performance-hero-actions {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 10px;
        }

        .performance-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-height: 46px;
          padding: 10px 16px;
          border: 1px solid transparent;
          border-radius: 15px;
          font: inherit;
          font-size: 13px;
          font-weight: 900;
          cursor: pointer;
          transition: transform 190ms ease, box-shadow 190ms ease, filter 190ms ease;
        }

        .performance-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          filter: saturate(1.04);
        }

        .performance-btn:disabled {
          opacity: .58;
          cursor: not-allowed;
        }

        .performance-btn-primary {
          color: #fff;
          background: linear-gradient(135deg, #342b78, #4f65d7 58%, #18b5c8);
          box-shadow: 5px 6px 0 #a9d6f5, 0 14px 25px rgba(36,74,128,.16);
        }

        .performance-btn-light {
          color: #40348d;
          background: rgba(255,255,255,.92);
          border-color: rgba(65,55,161,.18);
          box-shadow: 3px 4px 0 rgba(52,43,120,.10);
        }

        .performance-alert {
          padding: 14px 16px;
          border-radius: 18px;
          font-weight: 850;
          box-shadow: 4px 5px 0 rgba(52,43,120,.08);
        }

        .performance-alert-error {
          border: 1px solid rgba(216,77,104,.28);
          color: #a2344d;
          background: #fff0f2;
          box-shadow: 4px 5px 0 #f2c2cc;
        }

        .performance-alert-success {
          border: 1px solid rgba(52,201,196,.36);
          color: #047857;
          background: #eaf8f4;
          box-shadow: 4px 5px 0 #aee6d9;
        }

        .performance-stats-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 15px;
        }

        .performance-stat-card {
          min-width: 0;
          min-height: 135px;
          padding: 18px;
          border: 1px solid rgba(171,181,211,.66);
          border-radius: 22px;
          background: #edf6ff;
          box-shadow: 7px 9px 0 #b9d7ff, 0 18px 30px rgba(34,38,110,.09);
          transition: transform 190ms ease;
        }

        .performance-stat-card:nth-child(2) {
          background: #eaf8f4;
          box-shadow: 7px 9px 0 #aee6d9, 0 18px 30px rgba(34,38,110,.09);
        }

        .performance-stat-card:nth-child(3) {
          background: #fff4d5;
          box-shadow: 7px 9px 0 #ffe0a5, 0 18px 30px rgba(34,38,110,.09);
        }

        .performance-stat-card:nth-child(4) {
          background: #f1efff;
          box-shadow: 7px 9px 0 #c9c0ff, 0 18px 30px rgba(34,38,110,.09);
        }

        .performance-stat-card:hover {
          transform: translateY(-4px);
        }

        .performance-stat-icon {
          width: 42px;
          height: 42px;
          margin-bottom: 12px;
          display: grid;
          place-items: center;
          border-radius: 14px;
          color: #fff;
          background: linear-gradient(145deg, #6658dc, #18b5c8);
          box-shadow: 3px 4px 0 rgba(52,43,120,.18);
          animation: performance-icon-float 3.2s ease-in-out infinite;
        }

        .performance-stat-card span {
          display: block;
          color: #5d6785;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: .09em;
          text-transform: uppercase;
        }

        .performance-stat-card strong {
          display: block;
          margin-top: 8px;
          color: var(--pf-ink);
          font-family: Georgia, "Times New Roman", serif;
          font-size: clamp(27px, 2.6vw, 39px);
          line-height: 1;
        }

        .performance-stat-card small {
          display: block;
          margin-top: 8px;
          color: var(--pf-copy);
          font-size: 12px;
          font-weight: 750;
        }

        .performance-layout-grid,
        .performance-history-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 22px;
          align-items: start;
        }

        .performance-panel {
          min-width: 0;
          padding: clamp(20px, 2vw, 28px);
          border: 1px solid rgba(171,181,211,.70);
          border-radius: clamp(26px, 2.2vw, 36px);
          background: linear-gradient(145deg, #ffffff, #f7fbff);
          box-shadow: 8px 10px 0 #c4ccff, 0 24px 42px rgba(34,38,110,.10);
          transition: transform 210ms ease, box-shadow 210ms ease, border-color 210ms ease;
        }

        .performance-panel:hover {
          border-color: rgba(102,88,220,.28);
          transform: translateY(-3px);
          box-shadow: 10px 12px 0 #c4ccff, 0 30px 50px rgba(34,38,110,.14);
        }

        .performance-section-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 18px;
        }

        .performance-section-head h2 {
          margin: 0;
          color: var(--pf-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(25px, 2.3vw, 37px);
          font-weight: 760;
          line-height: 1;
          letter-spacing: -.045em;
        }

        .performance-section-head p {
          margin: 8px 0 0;
          color: var(--pf-copy);
          font-size: 13px;
          line-height: 1.58;
        }

        .performance-tabs {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin-bottom: 18px;
        }

        .performance-tabs.compact {
          margin-bottom: 0;
        }

        .performance-tabs button {
          min-height: 42px;
          padding: 9px 14px;
          border: 1px solid rgba(171,181,211,.62);
          border-radius: 999px;
          color: var(--pf-copy);
          background: #fff;
          box-shadow: 3px 4px 0 rgba(52,43,120,.08);
          font: inherit;
          font-size: 12px;
          font-weight: 900;
          cursor: pointer;
        }

        .performance-tabs button.active {
          color: #fff;
          background: #342b78;
          box-shadow: 4px 5px 0 #18b5c8, 0 12px 22px rgba(52,43,120,.14);
        }

        .performance-form {
          display: grid;
          gap: 15px;
        }

        .performance-form label {
          display: grid;
          gap: 8px;
          color: #303b5b;
          font-size: 11px;
          font-weight: 900;
        }

        .performance-form select,
        .performance-form textarea {
          width: 100%;
          border: 1px solid rgba(151,161,197,.58);
          border-radius: 15px;
          outline: 0;
          color: var(--pf-ink);
          background: rgba(255,255,255,.94);
          font: inherit;
        }

        .performance-form select {
          min-height: 47px;
          padding: 0 13px;
        }

        .performance-form textarea {
          min-height: 105px;
          padding: 13px;
          resize: vertical;
        }

        .performance-form select:focus,
        .performance-form textarea:focus {
          border-color: rgba(102,88,220,.65);
          box-shadow: 4px 5px 0 rgba(102,88,220,.14), 0 0 0 4px rgba(102,88,220,.08);
        }

        .performance-profile-card {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 15px;
          align-items: center;
          padding: 18px;
          border: 1px solid rgba(171,181,211,.55);
          border-radius: 22px;
          background: linear-gradient(145deg, #edf6ff, #f1efff);
          box-shadow: 5px 6px 0 #c9c0ff;
        }

        .performance-avatar {
          width: 72px;
          height: 72px;
          border-radius: 22px;
          display: grid;
          place-items: center;
          color: #fff;
          background: linear-gradient(145deg, #6658dc, #18b5c8);
          box-shadow: 5px 6px 0 #b9d7ff;
          font-size: 22px;
          font-weight: 900;
        }

        .performance-profile-card h3 {
          margin: 0;
          color: var(--pf-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: 24px;
          font-weight: 760;
        }

        .performance-profile-card p,
        .performance-profile-card span {
          display: block;
          margin: 5px 0 0;
          color: var(--pf-copy);
        }

        .performance-3d-chart {
          display: grid;
          gap: 14px;
        }

        .performance-3d-row {
          display: grid;
          grid-template-columns: minmax(150px, .45fr) minmax(0, 1fr);
          gap: 14px;
          align-items: center;
          padding: 13px;
          border: 1px solid rgba(171,181,211,.48);
          border-radius: 17px;
          background: rgba(255,255,255,.88);
          box-shadow: 3px 4px 0 rgba(52,43,120,.07);
        }

        .performance-3d-label strong {
          display: block;
          color: var(--pf-ink);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .performance-3d-label span {
          display: block;
          margin-top: 4px;
          color: var(--pf-copy);
          font-size: 11px;
          font-weight: 800;
        }

        .performance-3d-track {
          height: 25px;
          overflow: hidden;
          border-radius: 999px;
          background: #e5e8f1;
          box-shadow: inset 0 2px 5px rgba(15,23,42,.08);
        }

        .performance-3d-bar {
          min-width: 8%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          padding-right: 9px;
          border-radius: 999px;
          color: #fff;
          background: linear-gradient(90deg, #6658dc, #3766db 58%, #34c9c4);
          box-shadow: inset 0 4px 7px rgba(255,255,255,.22), inset 0 -5px 8px rgba(30,41,59,.18);
        }

        .performance-3d-bar span {
          font-size: 11px;
          font-weight: 950;
        }

        .performance-table-wrap {
          overflow-x: auto;
          border: 1px solid rgba(171,181,211,.50);
          border-radius: 18px;
          background: #fff;
          box-shadow: 4px 5px 0 rgba(52,43,120,.08);
        }

        .performance-table {
          width: 100%;
          min-width: 820px;
          border-collapse: collapse;
        }

        .performance-table th,
        .performance-table td {
          padding: 13px 14px;
          border-bottom: 1px solid rgba(171,181,211,.36);
          text-align: left;
          vertical-align: top;
        }

        .performance-table th {
          color: #536381;
          background: linear-gradient(180deg, #f8f8ff, #f4f8fb);
          font-size: 10px;
          font-weight: 950;
          text-transform: uppercase;
        }

        .performance-table td {
          color: var(--pf-copy);
          font-size: 12px;
        }

        .performance-table td strong {
          display: block;
          color: var(--pf-ink);
        }

        .performance-rating-pill {
          display: inline-flex !important;
          width: max-content;
          padding: 6px 9px;
          border-radius: 999px;
          color: #40348d;
          background: #f1efff;
          box-shadow: 2px 3px 0 #c9c0ff;
          font-weight: 900;
        }

        .performance-empty,
        .performance-loading {
          min-height: 220px;
          padding: 28px;
          display: grid;
          place-items: center;
          align-content: center;
          text-align: center;
          border: 1px dashed rgba(102,88,220,.34);
          border-radius: 20px;
          color: var(--pf-copy);
          background: linear-gradient(145deg, #f8f7ff, #effbf8);
          box-shadow: 4px 5px 0 rgba(52,43,120,.07);
        }

        .performance-empty-icon {
          width: 52px;
          height: 52px;
          display: grid;
          place-items: center;
          border-radius: 17px;
          color: #fff;
          background: linear-gradient(145deg, #6658dc, #18b5c8);
          box-shadow: 4px 5px 0 #b9d7ff;
        }

        .performance-empty h3 {
          margin: 13px 0 7px;
          color: var(--pf-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: 23px;
        }

        @keyframes performance-icon-float {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-3px) rotate(-3deg); }
        }

        @media (max-width: 1100px) {
          .performance-layout-grid,
          .performance-history-grid {
            grid-template-columns: 1fr;
          }

          .performance-stats-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 760px) {
          .performance-page {
            gap: 18px;
          }

          .performance-hero {
            grid-template-columns: 1fr;
            min-height: 0;
            padding: 20px;
            border-radius: 26px;
            box-shadow: 6px 7px 0 #c6d8f7, 0 18px 30px rgba(34,38,110,.10);
          }

          .performance-hero h1 {
            font-size: clamp(36px, 10vw, 52px);
          }

          .performance-hero-actions {
            width: 100%;
          }

          .performance-hero-actions .performance-btn {
            flex: 1;
          }

          .performance-stats-grid {
            grid-template-columns: 1fr;
          }

          .performance-panel {
            padding: 18px;
            border-radius: 22px;
            box-shadow: 5px 6px 0 #c4ccff, 0 17px 28px rgba(34,38,110,.09);
          }

          .performance-section-head {
            flex-direction: column;
          }

          .performance-3d-row {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 430px) {
          .performance-hero {
            padding: 16px;
          }

          .performance-hero h1 {
            font-size: clamp(32px, 11vw, 44px);
          }

          .performance-panel {
            padding: 15px;
          }

          .performance-tabs {
            display: grid;
            grid-template-columns: 1fr;
          }

          .performance-tabs button,
          .performance-btn {
            width: 100%;
          }

          .performance-profile-card {
            grid-template-columns: 1fr;
            text-align: center;
          }

          .performance-avatar {
            margin: 0 auto;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .performance-page *,
          .performance-page *::before,
          .performance-page *::after {
            animation: none !important;
            transition: none !important;
          }
        }
      `}</style>
        <section className="performance-hero">
          <div>
            <span className="performance-kicker">
              <Sparkles size={13} />
              Restricted Module
            </span>
            <h1>
              Performance access, <em>role protected.</em>
            </h1>
            <p>
              This page is available only for Team Leaders and Reporting Officers.
            </p>
          </div>
          <button
            type="button"
            className="performance-btn performance-btn-light"
            onClick={() => setPage?.('dashboard')}
          >
            Back to Dashboard
            <ArrowUpRight size={15} />
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="performance-page">

      <style>{`
        .performance-page {
          --pf-ink: #101a3a;
          --pf-copy: #5d6d8d;
          --pf-violet: #6658dc;
          --pf-blue: #3766db;
          --pf-cyan: #18b5c8;
          --pf-teal: #34c9c4;
          --pf-line: rgba(16, 26, 58, .14);
          display: grid;
          gap: clamp(18px, 2vw, 26px);
          min-width: 0;
          color: var(--pf-ink);
        }

        .performance-page * {
          box-sizing: border-box;
        }

        .performance-hero {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: center;
          gap: clamp(22px, 3vw, 40px);
          min-height: 275px;
          padding: clamp(25px, 3vw, 42px);
          border: 1px solid rgba(154, 164, 205, .58);
          border-radius: clamp(28px, 2.7vw, 40px);
          background:
            radial-gradient(circle at 8% 6%, rgba(105, 217, 208, .26), transparent 29%),
            radial-gradient(circle at 95% 4%, rgba(153, 164, 245, .24), transparent 31%),
            linear-gradient(135deg, #eef9ff 0%, #f8f3ff 52%, #effbf8 100%);
          box-shadow:
            12px 14px 0 #c6d8f7,
            0 28px 48px rgba(34, 38, 110, .13);
        }

        .performance-hero::before {
          content: "";
          position: absolute;
          z-index: -1;
          width: 175px;
          height: 175px;
          right: 8%;
          bottom: -98px;
          border-radius: 38% 62% 58% 42% / 48% 43% 57% 52%;
          background: linear-gradient(145deg, rgba(105,217,208,.30), rgba(132,181,241,.28));
          transform: rotate(-18deg);
        }

        .performance-kicker {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          width: max-content;
          max-width: 100%;
          margin-bottom: 13px;
          padding: 8px 12px;
          border-radius: 999px;
          color: #fff;
          background: #342b78;
          box-shadow: 4px 5px 0 #18b5c8;
          font-size: 9px;
          font-weight: 950;
          line-height: 1;
          letter-spacing: .11em;
          text-transform: uppercase;
        }

        .performance-hero h1 {
          max-width: 900px;
          margin: 0;
          color: var(--pf-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(44px, 5.2vw, 77px);
          font-weight: 760;
          line-height: .94;
          letter-spacing: -.058em;
        }

        .performance-hero h1 em {
          color: var(--pf-violet);
          font-family: Georgia, "Times New Roman", serif;
          font-weight: 500;
        }

        .performance-hero p {
          max-width: 840px;
          margin: 17px 0 0;
          color: var(--pf-copy);
          font-size: clamp(13px, 1vw, 16px);
          line-height: 1.68;
        }

        .performance-hero-actions {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 10px;
        }

        .performance-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-height: 46px;
          padding: 10px 16px;
          border: 1px solid transparent;
          border-radius: 15px;
          font: inherit;
          font-size: 13px;
          font-weight: 900;
          cursor: pointer;
          transition: transform 190ms ease, box-shadow 190ms ease, filter 190ms ease;
        }

        .performance-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          filter: saturate(1.04);
        }

        .performance-btn:disabled {
          opacity: .58;
          cursor: not-allowed;
        }

        .performance-btn-primary {
          color: #fff;
          background: linear-gradient(135deg, #342b78, #4f65d7 58%, #18b5c8);
          box-shadow: 5px 6px 0 #a9d6f5, 0 14px 25px rgba(36,74,128,.16);
        }

        .performance-btn-light {
          color: #40348d;
          background: rgba(255,255,255,.92);
          border-color: rgba(65,55,161,.18);
          box-shadow: 3px 4px 0 rgba(52,43,120,.10);
        }

        .performance-alert {
          padding: 14px 16px;
          border-radius: 18px;
          font-weight: 850;
          box-shadow: 4px 5px 0 rgba(52,43,120,.08);
        }

        .performance-alert-error {
          border: 1px solid rgba(216,77,104,.28);
          color: #a2344d;
          background: #fff0f2;
          box-shadow: 4px 5px 0 #f2c2cc;
        }

        .performance-alert-success {
          border: 1px solid rgba(52,201,196,.36);
          color: #047857;
          background: #eaf8f4;
          box-shadow: 4px 5px 0 #aee6d9;
        }

        .performance-stats-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 15px;
        }

        .performance-stat-card {
          min-width: 0;
          min-height: 135px;
          padding: 18px;
          border: 1px solid rgba(171,181,211,.66);
          border-radius: 22px;
          background: #edf6ff;
          box-shadow: 7px 9px 0 #b9d7ff, 0 18px 30px rgba(34,38,110,.09);
          transition: transform 190ms ease;
        }

        .performance-stat-card:nth-child(2) {
          background: #eaf8f4;
          box-shadow: 7px 9px 0 #aee6d9, 0 18px 30px rgba(34,38,110,.09);
        }

        .performance-stat-card:nth-child(3) {
          background: #fff4d5;
          box-shadow: 7px 9px 0 #ffe0a5, 0 18px 30px rgba(34,38,110,.09);
        }

        .performance-stat-card:nth-child(4) {
          background: #f1efff;
          box-shadow: 7px 9px 0 #c9c0ff, 0 18px 30px rgba(34,38,110,.09);
        }

        .performance-stat-card:hover {
          transform: translateY(-4px);
        }

        .performance-stat-icon {
          width: 42px;
          height: 42px;
          margin-bottom: 12px;
          display: grid;
          place-items: center;
          border-radius: 14px;
          color: #fff;
          background: linear-gradient(145deg, #6658dc, #18b5c8);
          box-shadow: 3px 4px 0 rgba(52,43,120,.18);
          animation: performance-icon-float 3.2s ease-in-out infinite;
        }

        .performance-stat-card span {
          display: block;
          color: #5d6785;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: .09em;
          text-transform: uppercase;
        }

        .performance-stat-card strong {
          display: block;
          margin-top: 8px;
          color: var(--pf-ink);
          font-family: Georgia, "Times New Roman", serif;
          font-size: clamp(27px, 2.6vw, 39px);
          line-height: 1;
        }

        .performance-stat-card small {
          display: block;
          margin-top: 8px;
          color: var(--pf-copy);
          font-size: 12px;
          font-weight: 750;
        }

        .performance-layout-grid,
        .performance-history-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 22px;
          align-items: start;
        }

        .performance-panel {
          min-width: 0;
          padding: clamp(20px, 2vw, 28px);
          border: 1px solid rgba(171,181,211,.70);
          border-radius: clamp(26px, 2.2vw, 36px);
          background: linear-gradient(145deg, #ffffff, #f7fbff);
          box-shadow: 8px 10px 0 #c4ccff, 0 24px 42px rgba(34,38,110,.10);
          transition: transform 210ms ease, box-shadow 210ms ease, border-color 210ms ease;
        }

        .performance-panel:hover {
          border-color: rgba(102,88,220,.28);
          transform: translateY(-3px);
          box-shadow: 10px 12px 0 #c4ccff, 0 30px 50px rgba(34,38,110,.14);
        }

        .performance-section-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 18px;
        }

        .performance-section-head h2 {
          margin: 0;
          color: var(--pf-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(25px, 2.3vw, 37px);
          font-weight: 760;
          line-height: 1;
          letter-spacing: -.045em;
        }

        .performance-section-head p {
          margin: 8px 0 0;
          color: var(--pf-copy);
          font-size: 13px;
          line-height: 1.58;
        }

        .performance-tabs {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin-bottom: 18px;
        }

        .performance-tabs.compact {
          margin-bottom: 0;
        }

        .performance-tabs button {
          min-height: 42px;
          padding: 9px 14px;
          border: 1px solid rgba(171,181,211,.62);
          border-radius: 999px;
          color: var(--pf-copy);
          background: #fff;
          box-shadow: 3px 4px 0 rgba(52,43,120,.08);
          font: inherit;
          font-size: 12px;
          font-weight: 900;
          cursor: pointer;
        }

        .performance-tabs button.active {
          color: #fff;
          background: #342b78;
          box-shadow: 4px 5px 0 #18b5c8, 0 12px 22px rgba(52,43,120,.14);
        }

        .performance-form {
          display: grid;
          gap: 15px;
        }

        .performance-form label {
          display: grid;
          gap: 8px;
          color: #303b5b;
          font-size: 11px;
          font-weight: 900;
        }

        .performance-form select,
        .performance-form textarea {
          width: 100%;
          border: 1px solid rgba(151,161,197,.58);
          border-radius: 15px;
          outline: 0;
          color: var(--pf-ink);
          background: rgba(255,255,255,.94);
          font: inherit;
        }

        .performance-form select {
          min-height: 47px;
          padding: 0 13px;
        }

        .performance-form textarea {
          min-height: 105px;
          padding: 13px;
          resize: vertical;
        }

        .performance-form select:focus,
        .performance-form textarea:focus {
          border-color: rgba(102,88,220,.65);
          box-shadow: 4px 5px 0 rgba(102,88,220,.14), 0 0 0 4px rgba(102,88,220,.08);
        }

        .performance-profile-card {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 15px;
          align-items: center;
          padding: 18px;
          border: 1px solid rgba(171,181,211,.55);
          border-radius: 22px;
          background: linear-gradient(145deg, #edf6ff, #f1efff);
          box-shadow: 5px 6px 0 #c9c0ff;
        }

        .performance-avatar {
          width: 72px;
          height: 72px;
          border-radius: 22px;
          display: grid;
          place-items: center;
          color: #fff;
          background: linear-gradient(145deg, #6658dc, #18b5c8);
          box-shadow: 5px 6px 0 #b9d7ff;
          font-size: 22px;
          font-weight: 900;
        }

        .performance-profile-card h3 {
          margin: 0;
          color: var(--pf-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: 24px;
          font-weight: 760;
        }

        .performance-profile-card p,
        .performance-profile-card span {
          display: block;
          margin: 5px 0 0;
          color: var(--pf-copy);
        }

        .performance-3d-chart {
          display: grid;
          gap: 14px;
        }

        .performance-3d-row {
          display: grid;
          grid-template-columns: minmax(150px, .45fr) minmax(0, 1fr);
          gap: 14px;
          align-items: center;
          padding: 13px;
          border: 1px solid rgba(171,181,211,.48);
          border-radius: 17px;
          background: rgba(255,255,255,.88);
          box-shadow: 3px 4px 0 rgba(52,43,120,.07);
        }

        .performance-3d-label strong {
          display: block;
          color: var(--pf-ink);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .performance-3d-label span {
          display: block;
          margin-top: 4px;
          color: var(--pf-copy);
          font-size: 11px;
          font-weight: 800;
        }

        .performance-3d-track {
          height: 25px;
          overflow: hidden;
          border-radius: 999px;
          background: #e5e8f1;
          box-shadow: inset 0 2px 5px rgba(15,23,42,.08);
        }

        .performance-3d-bar {
          min-width: 8%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          padding-right: 9px;
          border-radius: 999px;
          color: #fff;
          background: linear-gradient(90deg, #6658dc, #3766db 58%, #34c9c4);
          box-shadow: inset 0 4px 7px rgba(255,255,255,.22), inset 0 -5px 8px rgba(30,41,59,.18);
        }

        .performance-3d-bar span {
          font-size: 11px;
          font-weight: 950;
        }

        .performance-table-wrap {
          overflow-x: auto;
          border: 1px solid rgba(171,181,211,.50);
          border-radius: 18px;
          background: #fff;
          box-shadow: 4px 5px 0 rgba(52,43,120,.08);
        }

        .performance-table {
          width: 100%;
          min-width: 820px;
          border-collapse: collapse;
        }

        .performance-table th,
        .performance-table td {
          padding: 13px 14px;
          border-bottom: 1px solid rgba(171,181,211,.36);
          text-align: left;
          vertical-align: top;
        }

        .performance-table th {
          color: #536381;
          background: linear-gradient(180deg, #f8f8ff, #f4f8fb);
          font-size: 10px;
          font-weight: 950;
          text-transform: uppercase;
        }

        .performance-table td {
          color: var(--pf-copy);
          font-size: 12px;
        }

        .performance-table td strong {
          display: block;
          color: var(--pf-ink);
        }

        .performance-rating-pill {
          display: inline-flex !important;
          width: max-content;
          padding: 6px 9px;
          border-radius: 999px;
          color: #40348d;
          background: #f1efff;
          box-shadow: 2px 3px 0 #c9c0ff;
          font-weight: 900;
        }

        .performance-empty,
        .performance-loading {
          min-height: 220px;
          padding: 28px;
          display: grid;
          place-items: center;
          align-content: center;
          text-align: center;
          border: 1px dashed rgba(102,88,220,.34);
          border-radius: 20px;
          color: var(--pf-copy);
          background: linear-gradient(145deg, #f8f7ff, #effbf8);
          box-shadow: 4px 5px 0 rgba(52,43,120,.07);
        }

        .performance-empty-icon {
          width: 52px;
          height: 52px;
          display: grid;
          place-items: center;
          border-radius: 17px;
          color: #fff;
          background: linear-gradient(145deg, #6658dc, #18b5c8);
          box-shadow: 4px 5px 0 #b9d7ff;
        }

        .performance-empty h3 {
          margin: 13px 0 7px;
          color: var(--pf-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: 23px;
        }

        @keyframes performance-icon-float {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-3px) rotate(-3deg); }
        }

        @media (max-width: 1100px) {
          .performance-layout-grid,
          .performance-history-grid {
            grid-template-columns: 1fr;
          }

          .performance-stats-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 760px) {
          .performance-page {
            gap: 18px;
          }

          .performance-hero {
            grid-template-columns: 1fr;
            min-height: 0;
            padding: 20px;
            border-radius: 26px;
            box-shadow: 6px 7px 0 #c6d8f7, 0 18px 30px rgba(34,38,110,.10);
          }

          .performance-hero h1 {
            font-size: clamp(36px, 10vw, 52px);
          }

          .performance-hero-actions {
            width: 100%;
          }

          .performance-hero-actions .performance-btn {
            flex: 1;
          }

          .performance-stats-grid {
            grid-template-columns: 1fr;
          }

          .performance-panel {
            padding: 18px;
            border-radius: 22px;
            box-shadow: 5px 6px 0 #c4ccff, 0 17px 28px rgba(34,38,110,.09);
          }

          .performance-section-head {
            flex-direction: column;
          }

          .performance-3d-row {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 430px) {
          .performance-hero {
            padding: 16px;
          }

          .performance-hero h1 {
            font-size: clamp(32px, 11vw, 44px);
          }

          .performance-panel {
            padding: 15px;
          }

          .performance-tabs {
            display: grid;
            grid-template-columns: 1fr;
          }

          .performance-tabs button,
          .performance-btn {
            width: 100%;
          }

          .performance-profile-card {
            grid-template-columns: 1fr;
            text-align: center;
          }

          .performance-avatar {
            margin: 0 auto;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .performance-page *,
          .performance-page *::before,
          .performance-page *::after {
            animation: none !important;
            transition: none !important;
          }
        }
      `}</style>
      <section className="performance-hero">
        <div>
          <span className="performance-kicker">
            <Sparkles size={13} />
            Weekly Performance Rating
          </span>
          <h1>
            Performance that stays <em>visible.</em>
          </h1>
          <p>
            Team Leaders can review team members. Reporting Officers can review Team Leaders
            and mapped reporting members. Monthly and yearly analytics are generated from
            weekly ratings.
          </p>
        </div>

        <div className="performance-hero-actions">
          <button
            type="button"
            className="performance-btn performance-btn-light"
            onClick={() => loadData()}
            disabled={loading}
          >
            <RefreshCcw size={16} />
            Refresh
          </button>
          <button
            type="button"
            className="performance-btn performance-btn-primary"
            onClick={() => setPage?.('dashboard')}
          >
            Dashboard
            <ArrowUpRight size={15} />
          </button>
        </div>
      </section>

      {error ? <div className="performance-alert performance-alert-error">{error}</div> : null}
      {message ? <div className="performance-alert performance-alert-success">{message}</div> : null}

      <section className="performance-stats-grid">
        <StatCard
          label="My Average Rating"
          value={`${formatRating(stats.averageRating)} / 5`}
          meta={ratingLabel(stats.averageRating)}
          icon={<Star size={19} />}
        />
        <StatCard
          label="Reviews Received"
          value={stats.reviewsReceived}
          meta="Performance given to me"
          icon={<TrendingUp size={19} />}
        />
        <StatCard
          label="Reviews Given"
          value={stats.reviewsGiven}
          meta="Submitted by me"
          icon={<CheckCircle2 size={19} />}
        />
        <StatCard
          label="Reviewable Employees"
          value={stats.reviewable}
          meta={activeMode === 'team_leader' ? 'Team members' : 'Reporting scope'}
          icon={<UsersRound size={19} />}
        />
      </section>

      <section className="performance-layout-grid">
        <section className="performance-panel">
          <div className="performance-section-head">
            <div>
              <span className="performance-kicker">Submit Review</span>
              <h2>Weekly Rating Form</h2>
              <p>
                Submit one weekly score. If the same employee is reviewed again in the same
                week, backend will update that weekly review record.
              </p>
            </div>
          </div>

          <div className="performance-tabs">
            {isTeamLeader ? (
              <button
                type="button"
                className={activeMode === 'team_leader' ? 'active' : ''}
                onClick={() => setActiveMode('team_leader')}
              >
                Team Members
              </button>
            ) : null}

            {isReportingOfficer ? (
              <button
                type="button"
                className={activeMode === 'reporting_officer' ? 'active' : ''}
                onClick={() => setActiveMode('reporting_officer')}
              >
                Reporting Scope
              </button>
            ) : null}
          </div>

          {loading ? (
            <div className="performance-loading">Loading performance module...</div>
          ) : !reviewableEmployees.length ? (
            <EmptyState
              title="No mapped employees found"
              text="No employee is currently mapped under your performance review scope."
            />
          ) : (
            <form className="performance-form" onSubmit={handleSubmit}>
              <label>
                Select Employee
                <select
                  value={form.employee_id}
                  onChange={(event) => updateForm('employee_id', event.target.value)}
                >
                  {reviewableEmployees.map((item) => (
                    <option key={item.employee_id} value={item.employee_id}>
                      {item.employee_name} — {item.review_scope_label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Weekly Rating
                <select
                  value={form.rating}
                  onChange={(event) => updateForm('rating', event.target.value)}
                >
                  <option value="5">5 - Excellent</option>
                  <option value="4">4 - Good</option>
                  <option value="3">3 - Average</option>
                  <option value="2">2 - Needs Improvement</option>
                  <option value="1">1 - Poor</option>
                </select>
              </label>

              <label>
                Remarks
                <textarea
                  value={form.remarks}
                  onChange={(event) => updateForm('remarks', event.target.value)}
                  placeholder="Write a short weekly performance note..."
                  rows="4"
                />
              </label>

              <label>
                Strengths
                <textarea
                  value={form.strengths}
                  onChange={(event) => updateForm('strengths', event.target.value)}
                  placeholder="Mention strong points, delivery quality, teamwork, ownership..."
                  rows="3"
                />
              </label>

              <label>
                Improvement Areas
                <textarea
                  value={form.improvement_areas}
                  onChange={(event) => updateForm('improvement_areas', event.target.value)}
                  placeholder="Mention areas to improve for the upcoming week..."
                  rows="3"
                />
              </label>

              <button
                type="submit"
                className="performance-btn performance-btn-primary"
                disabled={saving}
              >
                <Send size={16} />
                {saving ? 'Submitting...' : 'Submit Weekly Rating'}
              </button>
            </form>
          )}
        </section>

        <section className="performance-panel">
          <div className="performance-section-head">
            <div>
              <span className="performance-kicker">Selected Employee</span>
              <h2>{selectedEmployee ? selectedEmployee.employee_name : 'No Employee Selected'}</h2>
              <p>
                {selectedEmployee
                  ? `${selectedEmployee.review_scope_label} • ${
                      selectedEmployee.department || 'Department not set'
                    } • ${selectedEmployee.designation || 'Designation not set'}`
                  : 'Choose an employee from the form to view details.'}
              </p>
            </div>
          </div>

          {selectedEmployee ? (
            <div className="performance-profile-card">
              <div className="performance-avatar">
                {String(selectedEmployee.employee_name || 'E').slice(0, 2).toUpperCase()}
              </div>
              <div>
                <h3>{selectedEmployee.employee_name}</h3>
                <p>{selectedEmployee.email || 'Email not available'}</p>
                <span>
                  {selectedEmployee.employee_code ||
                    selectedEmployee.raw_employee_id ||
                    selectedEmployee.emp_code ||
                    'No employee code'}
                </span>
              </div>
            </div>
          ) : (
            <EmptyState />
          )}
        </section>
      </section>

      <section className="performance-panel">
        <div className="performance-section-head">
          <div>
            <span className="performance-kicker">Auto Analytics</span>
            <h2>Weekly, Monthly and Yearly Performance</h2>
            <p>
              Weekly reviews are used to generate monthly and yearly analytics automatically.
            </p>
          </div>

          <div className="performance-tabs compact">
            <button
              type="button"
              className={graphMode === 'weekly' ? 'active' : ''}
              onClick={() => setGraphMode('weekly')}
            >
              Weekly
            </button>
            <button
              type="button"
              className={graphMode === 'monthly' ? 'active' : ''}
              onClick={() => setGraphMode('monthly')}
            >
              Monthly
            </button>
            <button
              type="button"
              className={graphMode === 'yearly' ? 'active' : ''}
              onClick={() => setGraphMode('yearly')}
            >
              Yearly
            </button>
          </div>
        </div>
      </section>

      <PerformanceGraph
        title={`${graphMode.charAt(0).toUpperCase()}${graphMode.slice(1)} Performance Overview`}
        subtitle="3D performance graph for weekly, monthly and yearly review analytics."
        chart={selectedGraph}
      />

      {isTeamLeader ? (
        <PerformanceGraph
          title="Team Member Weekly Graph"
          subtitle="Employee-wise weekly performance under Team Leader."
          chart={pickGraphSource(
            dashboard.team_member_weekly_graph,
            dashboard.team_performance_chart,
            dashboard.weekly_performance_chart,
            reviewHistory,
          )}
        />
      ) : null}

      {isReportingOfficer ? (
        <PerformanceGraph
          title="Reporting Officer Team Leader Graph"
          subtitle="Team Leader and reporting member performance visible employee-wise."
          chart={pickGraphSource(
            dashboard.reporting_team_leader_weekly_graph,
            dashboard.reporting_performance_chart,
            dashboard.weekly_performance_chart,
            reviewHistory,
          )}
        />
      ) : null}

      <div className="performance-history-grid">
        <ReviewHistory title="Reviews Received By Me" reviews={myReviews} />
        <ReviewHistory
          title="Reviews Submitted By Me"
          reviews={reviewsGiven.length ? reviewsGiven : reviewHistory}
        />
      </div>
    </main>
  );
}