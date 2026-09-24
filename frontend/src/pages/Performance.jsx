import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  RefreshCcw,
  Search,
  Send,
  Sparkles,
  XCircle,
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

const PERFORMANCE_NOTICE_HIDE_MS = 3600;
const PERFORMANCE_HISTORY_PAGE_SIZES = [10, 25, 50];

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

function StatCard({ label, value, meta }) {
  return (
    <div className="performance-stat-card">
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
          <span className="performance-kicker">Performance Trend</span>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </div>

      {!graphRows.length ? (
        <EmptyState
          title="No performance data yet"
          text="Submit a weekly performance rating first. The performance trend will appear immediately after saving."
        />
      ) : (
        <div className="performance-trend-chart">
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
            const safePercentage = Math.max(0, Math.min(100, percentage));

            return (
              <div className="performance-trend-row" key={`${name}-${index}`}>
                <div className="performance-trend-label">
                  <div>
                    <strong>{name}</strong>
                    <span>{ratingLabel(rating)}</span>
                  </div>

                  <strong className="performance-trend-value">
                    {formatRating(rating)} / 5
                  </strong>
                </div>

                <div
                  className="performance-trend-track"
                  aria-label={`${name} performance ${safePercentage.toFixed(0)} percent`}
                >
                  <div
                    className="performance-trend-bar"
                    style={{ width: `${safePercentage}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function performancePageNumbers(pageCount, page) {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const current = Math.max(1, Math.min(pageCount, page));
  const pages = new Set([1, pageCount, current]);

  if (current > 2) pages.add(current - 1);
  if (current < pageCount - 1) pages.add(current + 1);

  const sorted = Array.from(pages).sort((a, b) => a - b);
  const output = [];

  sorted.forEach((value, index) => {
    const previous = sorted[index - 1];

    if (index > 0 && value - previous > 1) {
      output.push(`ellipsis-${previous}-${value}`);
    }

    output.push(value);
  });

  return output;
}

function PerformanceInlineMessage({
  type = 'info',
  title = '',
  text = '',
  loading = false,
  onClose,
}) {
  if (!text) return null;

  return (
    <div className={`performance-inline-feedback ${type}`} role="status">
      <span className="performance-inline-feedback-icon">
        {loading ? (
          <RefreshCcw size={15} className="performance-spin" />
        ) : type === 'success' ? (
          <CheckCircle2 size={15} />
        ) : type === 'error' || type === 'warning' ? (
          <XCircle size={15} />
        ) : (
          <Sparkles size={15} />
        )}
      </span>

      <span className="performance-inline-feedback-copy">
        {title ? <strong>{title}</strong> : null}
        <span>{text}</span>
      </span>

      {onClose ? (
        <button
          type="button"
          className="performance-inline-feedback-close"
          onClick={onClose}
          aria-label="Dismiss notification"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

function ReviewHistory({ title, reviews }) {
  const rows = Array.isArray(reviews) ? reviews : [];
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const filteredRows = useMemo(() => {
    const term = String(search || '').trim().toLowerCase();

    if (!term) return rows;

    return rows.filter((item) => {
      const rating =
        item.rating_value ||
        item.rating ||
        item.score ||
        item.performance_score ||
        0;

      const haystack = [
        item.employee_name,
        item.target_employee_name,
        item.reviewer_name,
        item.reviewer_employee_name,
        item.review_scope_label,
        item.review_target_type,
        item.week_label,
        item.month_label,
        item.year_label,
        item.cycle,
        item.remarks,
        item.comments,
        item.note,
        formatRating(rating),
        ratingLabel(rating),
      ]
        .map((value) => String(value || '').trim().toLowerCase())
        .join(' ');

      return haystack.includes(term);
    });
  }, [rows, search]);

  const pageCount = Math.max(
    1,
    Math.ceil(filteredRows.length / Math.max(1, pageSize)),
  );
  const safePage = Math.min(Math.max(1, page), pageCount);
  const start = (safePage - 1) * pageSize;
  const pagedRows = filteredRows.slice(start, start + pageSize);

  useEffect(() => {
    setPage(1);
  }, [search, pageSize]);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  return (
    <section className="performance-panel">
      <div className="performance-section-head">
        <div>
          <span className="performance-kicker">Review History</span>
          <h2>{title}</h2>
          <p>
            Search review records and move through them with numbered pagination.
          </p>
        </div>
      </div>

      {rows.length ? (
        <div className="performance-history-controls">
          <div className="performance-search-wrap">
            <Search size={17} />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search employee, reviewer, period, rating or remarks..."
              aria-label={`Search ${title}`}
            />
          </div>

          <label className="performance-page-size-control">
            <span>View</span>
            <select
              value={pageSize}
              onChange={(event) => setPageSize(Number(event.target.value))}
              aria-label={`${title} rows per page`}
            >
              {PERFORMANCE_HISTORY_PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {!filteredRows.length ? (
        <EmptyState
          title={rows.length ? 'No matching reviews' : 'No reviews yet'}
          text={
            rows.length
              ? 'No review record matches the current search.'
              : 'Submitted and received reviews will appear here.'
          }
        />
      ) : (
        <>
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
                {pagedRows.map((item, index) => {
                  const rating =
                    item.rating_value ||
                    item.rating ||
                    item.score ||
                    item.performance_score ||
                    0;

                  return (
                    <tr key={item._id || `${item.employee_id}-${start + index}`}>
                      <td>
                        <strong>
                          {item.employee_name ||
                            item.target_employee_name ||
                            'Employee'}
                        </strong>
                        <span>
                          {item.review_scope_label ||
                            item.review_target_type ||
                            'Performance Review'}
                        </span>
                      </td>
                      <td>
                        {item.reviewer_name ||
                          item.reviewer_employee_name ||
                          '—'}
                      </td>
                      <td>
                        <span className="performance-rating-pill">
                          {formatRating(rating)} / 5
                        </span>
                      </td>
                      <td>
                        {item.week_label ||
                          item.month_label ||
                          item.year_label ||
                          item.cycle ||
                          'Weekly'}
                      </td>
                      <td>
                        {item.remarks ||
                          item.comments ||
                          item.note ||
                          '—'}
                      </td>
                      <td>{formatDate(item.review_date || item.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="performance-pagination">
            <div className="performance-pagination-copy">
              <strong>{filteredRows.length.toLocaleString('en-IN')}</strong>
              <span>reviews</span>
            </div>

            <div className="performance-pagination-controls">
              <button
                type="button"
                className="performance-page-button performance-page-nav"
                onClick={() => setPage(Math.max(1, safePage - 1))}
                disabled={safePage <= 1}
              >
                <ChevronLeft size={15} />
                <span>Previous</span>
              </button>

              <div className="performance-page-numbers" aria-label="Pagination">
                {performancePageNumbers(pageCount, safePage).map((item) =>
                  typeof item === 'number' ? (
                    <button
                      type="button"
                      key={item}
                      className={`performance-page-number ${
                        item === safePage ? 'active' : ''
                      }`}
                      onClick={() => setPage(item)}
                      aria-current={item === safePage ? 'page' : undefined}
                    >
                      {item}
                    </button>
                  ) : (
                    <span key={item} className="performance-page-ellipsis">
                      …
                    </span>
                  ),
                )}
              </div>

              <span className="performance-page-indicator">
                Page {safePage} of {pageCount}
              </span>

              <button
                type="button"
                className="performance-page-button performance-page-nav"
                onClick={() => setPage(Math.min(pageCount, safePage + 1))}
                disabled={safePage >= pageCount}
              >
                <span>Next</span>
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
        </>
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
  const [activeSection, setActiveSection] = useState('review');
  const [form, setForm] = useState(EMPTY_FORM);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [reviewFeedbackLoading, setReviewFeedbackLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [refreshFeedback, setRefreshFeedback] = useState({
    type: '',
    title: '',
    text: '',
    loading: false,
  });
  const refreshTimerRef = useRef(null);

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

  function showRefreshFeedback(
    type,
    text,
    title = '',
    loadingFeedback = false,
  ) {
    if (refreshTimerRef.current) {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    setRefreshFeedback({
      type,
      title,
      text,
      loading: loadingFeedback,
    });

    if (!loadingFeedback) {
      refreshTimerRef.current = window.setTimeout(() => {
        setRefreshFeedback({
          type: '',
          title: '',
          text: '',
          loading: false,
        });
        refreshTimerRef.current = null;
      }, PERFORMANCE_NOTICE_HIDE_MS);
    }
  }

  async function loadData(options = {}) {
    const keepMessage = Boolean(options.keepMessage);
    const feedbackScope = options.feedbackScope || '';

    setLoading(true);
    setLoadError('');

    if (!keepMessage) {
      setMessage('');
      setError('');
    }

    if (feedbackScope === 'refresh') {
      showRefreshFeedback(
        'info',
        'Refreshing performance dashboard and review history...',
        'Refreshing',
        true,
      );
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

      if (feedbackScope === 'refresh') {
        showRefreshFeedback(
          'success',
          'Performance dashboard and review history are up to date.',
          'Refresh Complete',
        );
      }
    } catch (err) {
      const errorMessage =
        err.message || 'Unable to load performance dashboard.';

      if (feedbackScope === 'refresh') {
        showRefreshFeedback(
          'error',
          errorMessage,
          'Refresh Failed',
        );
      } else {
        setLoadError(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if ((!message && !error) || reviewFeedbackLoading) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setMessage('');
      setError('');
    }, PERFORMANCE_NOTICE_HIDE_MS);

    return () => window.clearTimeout(timer);
  }, [message, error, reviewFeedbackLoading]);

  useEffect(() => {
    function dismissInlineFeedback(event) {
      if (event.target?.closest?.('.performance-inline-feedback')) return;

      setMessage('');
      setError('');

      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }

      setRefreshFeedback({
        type: '',
        title: '',
        text: '',
        loading: false,
      });
    }

    document.addEventListener('pointerdown', dismissInlineFeedback);

    return () => {
      document.removeEventListener('pointerdown', dismissInlineFeedback);
    };
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
    setReviewFeedbackLoading(false);

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
    setReviewFeedbackLoading(true);
    setMessage('Submitting weekly performance review...');

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

      setReviewFeedbackLoading(false);
      setMessage(response.message || 'Weekly performance review submitted successfully.');
      setForm((prev) => ({
        ...EMPTY_FORM,
        employee_id: prev.employee_id,
      }));

      await loadData({ keepMessage: true });
      setGraphMode('weekly');
    } catch (err) {
      setReviewFeedbackLoading(false);
      setMessage('');
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
          --pf-violet: #4d77dd;
          --pf-violet-deep: #575092;
          --pf-blue: #4d77dd;
          --pf-cyan: #2eb2b9;
          --pf-teal: #2eb2b9;
          --pf-line: rgba(16, 26, 58, .14);
          display: grid;
          gap: clamp(16px, 1.8vw, 24px);
          width: 100%;
          min-width: 0;
          max-width: 100%;
          padding-right: clamp(8px, 1vw, 14px);
          overflow-x: visible;
          color: var(--pf-ink);
          background: transparent;
        }

        .performance-page,
        .performance-page * {
          box-sizing: border-box;
        }

        .performance-page > *,
        .performance-page section,
        .performance-page article,
        .performance-page form,
        .performance-page nav,
        .performance-page label {
          min-width: 0;
          max-width: 100%;
        }

        .performance-page h1,
        .performance-page h2,
        .performance-page h3,
        .performance-page p,
        .performance-page strong,
        .performance-page small,
        .performance-page span {
          overflow-wrap: anywhere;
        }

      .performance-page::before,
.performance-page::after,
.performance-page .performance-hero::before,
.performance-page .performance-hero::after,
.performance-page .performance-panel::before,
.performance-page .performance-panel::after,
.performance-page .performance-stat-card::before,
.performance-page .performance-stat-card::after {
  content: none;
  display: none;
  background: none;
}

        .performance-hero {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(190px, 300px);
          align-items: center;
          gap: clamp(20px, 3vw, 36px);
          min-height: 250px;
          padding: clamp(24px, 3vw, 40px);
          border: 1px solid rgba(154,164,205,.58);
          border-radius: clamp(28px, 2.7vw, 40px);
          background: linear-gradient(
            90deg,
            #d3f4fb 0%,
            #f7fcfb 34%,
            #fffdf8 52%,
            #fbf8fa 68%,
            #f0edfb 100%
          );
          box-shadow:
            10px 12px 0 #b9d7ff,
            0 26px 44px rgba(70,92,140,.12);
        }


        .performance-kicker {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          width: max-content;
          max-width: 100%;
          margin-bottom: 13px;
          padding: 9px 13px;
          border-radius: 999px;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow: 4px 5px 0 #575092;
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

        .performance-btn-primary,
        .performance-btn-light {
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          border-color: rgba(77,119,221,.18);
          box-shadow: 5px 6px 0 #575092;
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
          min-height: 120px;
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
          border-color: rgba(77,119,221,.30);
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
          overflow: hidden;
          border: 1px solid rgba(171,181,211,.70);
          border-radius: clamp(26px, 2.2vw, 36px);
          background: #ffffff;
          box-shadow:
            8px 10px 0 #c4ccff,
            0 24px 42px rgba(34,38,110,.10);
          transition: border-color 180ms ease, box-shadow 180ms ease;
        }

        .performance-panel:hover {
          border-color: rgba(77,119,221,.28);
        }

        .performance-graph-panel {
          box-shadow: 0 14px 32px rgba(34,38,110,.08);
        }

        .performance-graph-panel:hover {
          box-shadow: 0 14px 32px rgba(34,38,110,.08);
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


        .performance-section-tabs {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
          width: 100%;
          padding: 12px;
          border: 1px solid rgba(171,181,211,.62);
          border-radius: 22px;
          background: #fff;
          box-shadow:
            6px 7px 0 #c4ccff,
            0 16px 28px rgba(34,38,110,.08);
        }

        .performance-section-tab {
          min-width: 0;
          min-height: 62px;
          padding: 11px 14px;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          gap: 10px;
          align-items: center;
          border: 1px solid rgba(77,119,221,.22);
          border-radius: 16px;
          color: #4767b4;
          background: linear-gradient(135deg, #f0f5ff 0%, #eefcfb 100%);
          box-shadow: 3px 4px 0 rgba(87,80,146,.16);
          text-align: left;
          font: inherit;
          cursor: pointer;
          transition:
            transform 190ms ease,
            border-color 190ms ease,
            box-shadow 190ms ease;
        }

        .performance-section-tab:hover {
          transform: translateY(-2px);
          border-color: rgba(46,178,185,.46);
        }

        .performance-section-tab.active {
          border-color: transparent;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow: 5px 6px 0 #575092;
        }

        .performance-section-tab-copy {
          min-width: 0;
          display: grid;
          gap: 3px;
        }

        .performance-section-tab-copy strong {
          font-size: 12px;
          font-weight: 950;
          line-height: 1.2;
        }

        .performance-section-tab-copy small {
          color: #6b7692;
          font-size: 9px;
          font-weight: 750;
          line-height: 1.25;
        }

        .performance-section-tab.active .performance-section-tab-copy small {
          color: rgba(255,255,255,.78);
        }

        .performance-section-tab-count {
          min-width: 30px;
          height: 30px;
          padding: 0 7px;
          display: inline-grid;
          place-items: center;
          border-radius: 10px;
          color: #40348d;
          background: #fff;
          box-shadow: 2px 3px 0 rgba(52,43,120,.10);
          font-size: 10px;
          font-weight: 950;
          white-space: nowrap;
        }

        .performance-section-content {
          animation: performanceSectionReveal 220ms ease both;
        }

        @keyframes performanceSectionReveal {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .performance-action-stack,
        .performance-hero-refresh-stack {
          display: grid;
          gap: 8px;
          min-width: 0;
        }

        .performance-action-stack {
          width: 100%;
        }

        .performance-action-stack > .performance-btn {
          width: 100%;
        }

        .performance-hero-refresh-stack {
          width: min(320px, 100%);
        }

        .performance-inline-feedback {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          gap: 9px;
          align-items: start;
          width: 100%;
          min-width: 0;
          padding: 10px 11px;
          border: 1px solid rgba(102,88,220,.18);
          border-radius: 12px;
          color: #40348d;
          background: #f1efff;
          box-shadow: 3px 4px 0 #c9c0ff;
          font-size: 10px;
          line-height: 1.45;
        }

        .performance-inline-feedback.success {
          border-color: rgba(4,120,87,.18);
          color: #047857;
          background: #eaf8f4;
          box-shadow: 3px 4px 0 #aee6d9;
        }

        .performance-inline-feedback.warning {
          border-color: rgba(154,104,23,.18);
          color: #9a6817;
          background: #fff4d5;
          box-shadow: 3px 4px 0 #ffe0a5;
        }

        .performance-inline-feedback.error {
          border-color: rgba(162,52,77,.18);
          color: #a2344d;
          background: #fff0f2;
          box-shadow: 3px 4px 0 #f2c2cc;
        }

        .performance-inline-feedback-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          flex: 0 0 22px;
        }

        .performance-inline-feedback-copy {
          min-width: 0;
        }

        .performance-inline-feedback-copy strong,
        .performance-inline-feedback-copy span {
          display: block;
          overflow-wrap: anywhere;
        }

        .performance-inline-feedback-copy strong {
          margin-bottom: 2px;
          font-weight: 950;
        }

        .performance-inline-feedback-copy span {
          font-weight: 750;
        }

        .performance-inline-feedback-close {
          width: 24px;
          min-width: 24px;
          height: 24px;
          display: inline-grid;
          place-items: center;
          margin: -2px -3px -2px 0;
          padding: 0;
          border: 0;
          border-radius: 8px;
          color: currentColor;
          background: rgba(255,255,255,.58);
          box-shadow: none;
          font: inherit;
          font-size: 17px;
          line-height: 1;
          cursor: pointer;
        }

        .performance-inline-feedback-close:hover {
          transform: none;
          filter: none;
          background: #fff;
        }

        .performance-spin {
          animation: performanceSpin .8s linear infinite;
        }

        @keyframes performanceSpin {
          to { transform: rotate(360deg); }
        }

        .performance-history-controls {
          display: grid;
          grid-template-columns: minmax(220px, 1fr) auto;
          gap: 10px;
          align-items: center;
          margin-bottom: 16px;
        }

        .performance-search-wrap {
          position: relative;
          min-width: 0;
        }

        .performance-search-wrap > svg {
          position: absolute;
          top: 50%;
          left: 13px;
          color: var(--pf-violet);
          transform: translateY(-50%);
          pointer-events: none;
        }

        .performance-search-wrap input,
        .performance-page-size-control select {
          width: 100%;
          min-height: 44px;
          border: 1px solid rgba(151,161,197,.58);
          border-radius: 13px;
          outline: 0;
          color: var(--pf-ink);
          background: rgba(255,255,255,.96);
          font: inherit;
        }

        .performance-search-wrap input {
          padding: 0 13px 0 39px;
        }

        .performance-search-wrap input:focus,
        .performance-page-size-control select:focus {
          border-color: rgba(102,88,220,.65);
          box-shadow:
            0 0 0 4px rgba(102,88,220,.08),
            3px 4px 0 rgba(102,88,220,.10);
        }

        .performance-page-size-control {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          color: var(--pf-copy);
          font-size: 10px;
          font-weight: 900;
          white-space: nowrap;
        }

        .performance-page-size-control select {
          width: auto;
          min-width: 78px;
          padding: 0 28px 0 10px;
          color: #40348d;
          background: #f1efff;
          box-shadow: 2px 3px 0 #c9c0ff;
          font-size: 10px;
          font-weight: 900;
        }

        .performance-pagination {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          width: 100%;
          min-width: 0;
          margin-top: 15px;
          padding: 12px 13px;
          border: 1px solid rgba(171,181,211,.52);
          border-radius: 16px;
          background: #f8f9ff;
          box-shadow: 3px 4px 0 rgba(52,43,120,.07);
        }

        .performance-pagination-copy {
          display: flex;
          align-items: baseline;
          gap: 6px;
          color: var(--pf-copy);
          font-size: 10px;
          font-weight: 850;
        }

        .performance-pagination-copy strong {
          color: var(--pf-ink);
          font-size: 13px;
          font-weight: 950;
        }

        .performance-pagination-controls {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          min-width: 0;
          flex-wrap: wrap;
        }

        .performance-page-button,
        .performance-page-number {
          border: 1px solid rgba(98,84,218,.18);
          color: #4767b4;
          background: #fff;
          box-shadow: 2px 3px 0 rgba(87,80,146,.12);
          font: inherit;
          font-weight: 900;
          cursor: pointer;
          transition:
            transform 190ms ease,
            box-shadow 190ms ease,
            filter 190ms ease;
        }

        .performance-page-button {
          min-width: 38px;
          height: 38px;
          padding: 0 10px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          border-radius: 12px;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow: 4px 5px 0 #575092;
          font-size: 10px;
        }

        .performance-page-nav {
          min-width: 78px;
        }

        .performance-page-numbers {
          display: flex;
          align-items: center;
          gap: 5px;
        }

        .performance-page-number {
          width: 36px;
          height: 36px;
          padding: 0;
          display: grid;
          place-items: center;
          border-radius: 11px;
          font-size: 10px;
        }

        .performance-page-number.active {
          border-color: transparent;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow: 3px 4px 0 #575092;
        }

        .performance-page-button:hover:not(:disabled),
        .performance-page-number:hover:not(:disabled) {
          transform: translateY(-2px);
          filter: saturate(1.04);
        }

        .performance-page-button:disabled,
        .performance-page-number:disabled {
          opacity: .52;
          cursor: not-allowed;
          transform: none;
        }

        .performance-page-ellipsis {
          width: 18px;
          text-align: center;
          color: #7b88a5;
          font-weight: 900;
        }

        .performance-page-indicator {
          min-width: 82px;
          color: var(--pf-copy);
          font-size: 10px;
          font-weight: 900;
          text-align: center;
          white-space: nowrap;
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
          border: 1px solid rgba(77,119,221,.22);
          border-radius: 14px;
          color: #4767b4;
          background: linear-gradient(135deg, #f0f5ff 0%, #eefcfb 100%);
          box-shadow: 3px 4px 0 rgba(87,80,146,.12);
          font: inherit;
          font-size: 12px;
          font-weight: 900;
          cursor: pointer;
          transition:
            transform 180ms ease,
            border-color 180ms ease,
            box-shadow 180ms ease;
        }

        .performance-tabs button:hover:not(:disabled) {
          transform: translateY(-1px);
          border-color: rgba(46,178,185,.46);
        }

        .performance-tabs button.active {
          border-color: transparent;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow: 4px 5px 0 #575092;
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
          background: #f5f5ff;
          box-shadow: 5px 6px 0 #c9c0ff;
        }

        .performance-avatar {
          width: 72px;
          height: 72px;
          border-radius: 22px;
          display: grid;
          place-items: center;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
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

        .performance-trend-chart {
          display: grid;
          gap: 12px;
        }

        .performance-trend-row {
          display: grid;
          gap: 12px;
          padding: 15px;
          border: 1px solid rgba(171,181,211,.50);
          border-radius: 16px;
          background: #ffffff;
          transition:
            border-color 180ms ease,
            background 180ms ease;
        }

        .performance-trend-row:hover {
          border-color: rgba(77,119,221,.30);
          background: #fbfcff;
        }

        .performance-trend-label {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          min-width: 0;
        }

        .performance-trend-label > div {
          min-width: 0;
        }

        .performance-trend-label strong {
          display: block;
          color: var(--pf-ink);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .performance-trend-label span {
          display: inline-flex;
          width: max-content;
          max-width: 100%;
          margin-top: 5px;
          padding: 4px 8px;
          border: 1px solid rgba(77,119,221,.14);
          border-radius: 999px;
          color: #5d6785;
          background: #f0f5ff;
          font-size: 10px;
          font-weight: 850;
          line-height: 1.2;
        }

        .performance-trend-value {
          flex: 0 0 auto;
          color: #4767b4 !important;
          font-size: 12px;
          font-weight: 950;
          white-space: nowrap;
        }

        .performance-trend-track {
          width: 100%;
          height: 10px;
          overflow: hidden;
          border-radius: 999px;
          background: #edf1f7;
        }

        .performance-trend-bar {
          height: 100%;
          border-radius: inherit;
          background: linear-gradient(90deg, #4d77dd 0%, #2eb2b9 100%);
          transition: width .34s cubic-bezier(.22, 1, .36, 1);
        }

        .performance-table-wrap {
          overflow-x: auto;
          border: 1px solid rgba(171,181,211,.50);
          border-radius: 18px;
          background: #fff;
          box-shadow: 0 10px 24px rgba(34,38,110,.06);
          overscroll-behavior-x: contain;
          -webkit-overflow-scrolling: touch;
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
          background: #f8f9ff;
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
          color: #4767b4;
          background: #f0f5ff;
          box-shadow: none;
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
          border: 1px dashed rgba(77,119,221,.28);
          border-radius: 20px;
          color: var(--pf-copy);
          background: #f8f9ff;
          box-shadow: none;
        }

        .performance-empty-icon {
          width: 52px;
          height: 52px;
          display: grid;
          place-items: center;
          border-radius: 17px;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow: 3px 4px 0 #b9d7ff;
        }

        .performance-empty h3 {
          margin: 13px 0 7px;
          color: var(--pf-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: 23px;
        }


        @media (max-width: 1180px) {
          .performance-hero {
            grid-template-columns: minmax(0, 1fr);
            min-height: 0;
          }

          .performance-hero-actions {
            justify-content: flex-start;
          }

          .performance-hero-refresh-stack {
            width: min(420px, 100%);
          }

          .performance-section-tab-copy small {
            display: none;
          }
        }

        @media (max-width: 900px) {
          .performance-page {
            gap: 18px;
          }

          .performance-section-tabs {
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 8px;
            padding: 10px;
          }

          .performance-section-tab {
            grid-template-columns: minmax(0, 1fr);
            min-height: 52px;
            padding: 9px 10px;
            text-align: center;
          }

          .performance-section-tab > svg,
          .performance-section-tab-count,
          .performance-section-tab-copy small {
            display: none;
          }

          .performance-section-tab-copy {
            display: block;
            text-align: center;
          }

          .performance-section-tab-copy strong {
            font-size: 11px;
          }
        }

        @media (max-width: 1100px) {
          .performance-layout-grid,
          .performance-history-grid {
            grid-template-columns: 1fr;
          }

          .performance-stats-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .performance-pagination {
            align-items: flex-start;
            flex-direction: column;
          }

          .performance-pagination-controls {
            width: 100%;
            justify-content: flex-start;
          }
        }

        @media (max-width: 760px) {
          .performance-page {
            gap: 14px;
            padding-right: 8px;
            overflow-x: visible;
          }

          .performance-hero {
            grid-template-columns: 1fr;
            min-height: 0;
            padding: 20px;
            border-radius: 26px;
            box-shadow: 6px 7px 0 #b9d7ff, 0 18px 30px rgba(34,38,110,.10);
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
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
          }

          .performance-section-tabs {
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 8px;
            padding: 8px;
            border-radius: 16px;
          }

          .performance-section-tab {
            min-height: 44px;
            padding: 8px 9px;
            border-radius: 11px;
          }

          .performance-section-tab-copy strong {
            font-size: 10.5px;
          }

          .performance-history-controls {
            grid-template-columns: 1fr;
          }

          .performance-page-size-control {
            justify-content: space-between;
          }

          .performance-page-size-control select {
            flex: 1 1 auto;
          }

          .performance-pagination-controls {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            align-items: stretch;
          }

          .performance-page-numbers,
          .performance-page-indicator {
            grid-column: 1 / -1;
            justify-self: stretch;
          }

          .performance-page-numbers {
            justify-content: center;
            flex-wrap: wrap;
          }

          .performance-page-nav {
            width: 100%;
          }

          .performance-panel {
            padding: 16px;
            border-radius: 20px;
            box-shadow: 4px 5px 0 #c4ccff, 0 14px 24px rgba(34,38,110,.08);
          }

          .performance-graph-panel {
            box-shadow: 0 10px 22px rgba(34,38,110,.07);
          }

          .performance-section-head {
            flex-direction: column;
          }

          .performance-trend-label {
            align-items: flex-start;
          }
        }

        @media (max-width: 560px) {
          .performance-section-tabs {
            grid-template-columns: minmax(0, 1fr);
          }

          .performance-section-tab,
          .performance-section-tab-copy {
            text-align: left;
          }

          .performance-hero-actions,
          .performance-hero-refresh-stack,
          .performance-action-stack {
            width: 100%;
          }

          .performance-hero-actions {
            align-items: stretch;
            flex-direction: column;
          }

          .performance-hero-actions .performance-btn {
            width: 100%;
          }

          .performance-trend-label {
            align-items: flex-start;
            flex-direction: column;
            gap: 8px;
          }
        }

        @media (max-width: 430px) {
          .performance-stats-grid {
            grid-template-columns: minmax(0, 1fr);
          }

          .performance-stat-card {
            min-height: 72px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 13px;
          }

          .performance-stat-card strong {
            margin-top: 0;
          }

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

          .performance-hero-actions {
            flex-direction: column;
            align-items: stretch;
          }

          .performance-hero-refresh-stack {
            width: 100%;
          }

          .performance-page-number {
            width: 34px;
            height: 34px;
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
          --pf-violet: #4d77dd;
          --pf-violet-deep: #575092;
          --pf-blue: #4d77dd;
          --pf-cyan: #2eb2b9;
          --pf-teal: #2eb2b9;
          --pf-line: rgba(16, 26, 58, .14);
          display: grid;
          gap: clamp(16px, 1.8vw, 24px);
          width: 100%;
          min-width: 0;
          max-width: 100%;
          padding-right: clamp(8px, 1vw, 14px);
          overflow-x: visible;
          color: var(--pf-ink);
          background: transparent;
        }

        .performance-page,
        .performance-page * {
          box-sizing: border-box;
        }

        .performance-page > *,
        .performance-page section,
        .performance-page article,
        .performance-page form,
        .performance-page nav,
        .performance-page label {
          min-width: 0;
          max-width: 100%;
        }

        .performance-page h1,
        .performance-page h2,
        .performance-page h3,
        .performance-page p,
        .performance-page strong,
        .performance-page small,
        .performance-page span {
          overflow-wrap: anywhere;
        }

       .performance-page::before,
.performance-page::after,
.performance-page .performance-hero::before,
.performance-page .performance-hero::after,
.performance-page .performance-panel::before,
.performance-page .performance-panel::after,
.performance-page .performance-stat-card::before,
.performance-page .performance-stat-card::after {
  content: none;
  display: none;
  background: none;
}

        .performance-hero {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(190px, 300px);
          align-items: center;
          gap: clamp(20px, 3vw, 36px);
          min-height: 250px;
          padding: clamp(24px, 3vw, 40px);
          border: 1px solid rgba(154,164,205,.58);
          border-radius: clamp(28px, 2.7vw, 40px);
          background: linear-gradient(
            90deg,
            #d3f4fb 0%,
            #f7fcfb 34%,
            #fffdf8 52%,
            #fbf8fa 68%,
            #f0edfb 100%
          );
          box-shadow:
            10px 12px 0 #b9d7ff,
            0 26px 44px rgba(70,92,140,.12);
        }

    

        .performance-kicker {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          width: max-content;
          max-width: 100%;
          margin-bottom: 13px;
          padding: 9px 13px;
          border-radius: 999px;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow: 4px 5px 0 #575092;
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

        .performance-btn-primary,
        .performance-btn-light {
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          border-color: rgba(77,119,221,.18);
          box-shadow: 5px 6px 0 #575092;
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
          min-height: 120px;
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
          border-color: rgba(77,119,221,.30);
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
          overflow: hidden;
          border: 1px solid rgba(171,181,211,.70);
          border-radius: clamp(26px, 2.2vw, 36px);
          background: #ffffff;
          box-shadow:
            8px 10px 0 #c4ccff,
            0 24px 42px rgba(34,38,110,.10);
          transition: border-color 180ms ease, box-shadow 180ms ease;
        }

        .performance-panel:hover {
          border-color: rgba(77,119,221,.28);
        }

        .performance-graph-panel {
          box-shadow: 0 14px 32px rgba(34,38,110,.08);
        }

        .performance-graph-panel:hover {
          box-shadow: 0 14px 32px rgba(34,38,110,.08);
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


        .performance-section-tabs {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
          width: 100%;
          padding: 12px;
          border: 1px solid rgba(171,181,211,.62);
          border-radius: 22px;
          background: #fff;
          box-shadow:
            6px 7px 0 #c4ccff,
            0 16px 28px rgba(34,38,110,.08);
        }

        .performance-section-tab {
          min-width: 0;
          min-height: 62px;
          padding: 11px 14px;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          gap: 10px;
          align-items: center;
          border: 1px solid rgba(77,119,221,.22);
          border-radius: 16px;
          color: #4767b4;
          background: linear-gradient(135deg, #f0f5ff 0%, #eefcfb 100%);
          box-shadow: 3px 4px 0 rgba(87,80,146,.16);
          text-align: left;
          font: inherit;
          cursor: pointer;
          transition:
            transform 190ms ease,
            border-color 190ms ease,
            box-shadow 190ms ease;
        }

        .performance-section-tab:hover {
          transform: translateY(-2px);
          border-color: rgba(46,178,185,.46);
        }

        .performance-section-tab.active {
          border-color: transparent;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow: 5px 6px 0 #575092;
        }

        .performance-section-tab-copy {
          min-width: 0;
          display: grid;
          gap: 3px;
        }

        .performance-section-tab-copy strong {
          font-size: 12px;
          font-weight: 950;
          line-height: 1.2;
        }

        .performance-section-tab-copy small {
          color: #6b7692;
          font-size: 9px;
          font-weight: 750;
          line-height: 1.25;
        }

        .performance-section-tab.active .performance-section-tab-copy small {
          color: rgba(255,255,255,.78);
        }

        .performance-section-tab-count {
          min-width: 30px;
          height: 30px;
          padding: 0 7px;
          display: inline-grid;
          place-items: center;
          border-radius: 10px;
          color: #40348d;
          background: #fff;
          box-shadow: 2px 3px 0 rgba(52,43,120,.10);
          font-size: 10px;
          font-weight: 950;
          white-space: nowrap;
        }

        .performance-section-content {
          animation: performanceSectionReveal 220ms ease both;
        }

        @keyframes performanceSectionReveal {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .performance-action-stack,
        .performance-hero-refresh-stack {
          display: grid;
          gap: 8px;
          min-width: 0;
        }

        .performance-action-stack {
          width: 100%;
        }

        .performance-action-stack > .performance-btn {
          width: 100%;
        }

        .performance-hero-refresh-stack {
          width: min(320px, 100%);
        }

        .performance-inline-feedback {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          gap: 9px;
          align-items: start;
          width: 100%;
          min-width: 0;
          padding: 10px 11px;
          border: 1px solid rgba(102,88,220,.18);
          border-radius: 12px;
          color: #40348d;
          background: #f1efff;
          box-shadow: 3px 4px 0 #c9c0ff;
          font-size: 10px;
          line-height: 1.45;
        }

        .performance-inline-feedback.success {
          border-color: rgba(4,120,87,.18);
          color: #047857;
          background: #eaf8f4;
          box-shadow: 3px 4px 0 #aee6d9;
        }

        .performance-inline-feedback.warning {
          border-color: rgba(154,104,23,.18);
          color: #9a6817;
          background: #fff4d5;
          box-shadow: 3px 4px 0 #ffe0a5;
        }

        .performance-inline-feedback.error {
          border-color: rgba(162,52,77,.18);
          color: #a2344d;
          background: #fff0f2;
          box-shadow: 3px 4px 0 #f2c2cc;
        }

        .performance-inline-feedback-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          flex: 0 0 22px;
        }

        .performance-inline-feedback-copy {
          min-width: 0;
        }

        .performance-inline-feedback-copy strong,
        .performance-inline-feedback-copy span {
          display: block;
          overflow-wrap: anywhere;
        }

        .performance-inline-feedback-copy strong {
          margin-bottom: 2px;
          font-weight: 950;
        }

        .performance-inline-feedback-copy span {
          font-weight: 750;
        }

        .performance-inline-feedback-close {
          width: 24px;
          min-width: 24px;
          height: 24px;
          display: inline-grid;
          place-items: center;
          margin: -2px -3px -2px 0;
          padding: 0;
          border: 0;
          border-radius: 8px;
          color: currentColor;
          background: rgba(255,255,255,.58);
          box-shadow: none;
          font: inherit;
          font-size: 17px;
          line-height: 1;
          cursor: pointer;
        }

        .performance-inline-feedback-close:hover {
          transform: none;
          filter: none;
          background: #fff;
        }

        .performance-spin {
          animation: performanceSpin .8s linear infinite;
        }

        @keyframes performanceSpin {
          to { transform: rotate(360deg); }
        }

        .performance-history-controls {
          display: grid;
          grid-template-columns: minmax(220px, 1fr) auto;
          gap: 10px;
          align-items: center;
          margin-bottom: 16px;
        }

        .performance-search-wrap {
          position: relative;
          min-width: 0;
        }

        .performance-search-wrap > svg {
          position: absolute;
          top: 50%;
          left: 13px;
          color: var(--pf-violet);
          transform: translateY(-50%);
          pointer-events: none;
        }

        .performance-search-wrap input,
        .performance-page-size-control select {
          width: 100%;
          min-height: 44px;
          border: 1px solid rgba(151,161,197,.58);
          border-radius: 13px;
          outline: 0;
          color: var(--pf-ink);
          background: rgba(255,255,255,.96);
          font: inherit;
        }

        .performance-search-wrap input {
          padding: 0 13px 0 39px;
        }

        .performance-search-wrap input:focus,
        .performance-page-size-control select:focus {
          border-color: rgba(102,88,220,.65);
          box-shadow:
            0 0 0 4px rgba(102,88,220,.08),
            3px 4px 0 rgba(102,88,220,.10);
        }

        .performance-page-size-control {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          color: var(--pf-copy);
          font-size: 10px;
          font-weight: 900;
          white-space: nowrap;
        }

        .performance-page-size-control select {
          width: auto;
          min-width: 78px;
          padding: 0 28px 0 10px;
          color: #40348d;
          background: #f1efff;
          box-shadow: 2px 3px 0 #c9c0ff;
          font-size: 10px;
          font-weight: 900;
        }

        .performance-pagination {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          width: 100%;
          min-width: 0;
          margin-top: 15px;
          padding: 12px 13px;
          border: 1px solid rgba(171,181,211,.52);
          border-radius: 16px;
          background: #f8f9ff;
          box-shadow: 3px 4px 0 rgba(52,43,120,.07);
        }

        .performance-pagination-copy {
          display: flex;
          align-items: baseline;
          gap: 6px;
          color: var(--pf-copy);
          font-size: 10px;
          font-weight: 850;
        }

        .performance-pagination-copy strong {
          color: var(--pf-ink);
          font-size: 13px;
          font-weight: 950;
        }

        .performance-pagination-controls {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          min-width: 0;
          flex-wrap: wrap;
        }

        .performance-page-button,
        .performance-page-number {
          border: 1px solid rgba(98,84,218,.18);
          color: #4767b4;
          background: #fff;
          box-shadow: 2px 3px 0 rgba(87,80,146,.12);
          font: inherit;
          font-weight: 900;
          cursor: pointer;
          transition:
            transform 190ms ease,
            box-shadow 190ms ease,
            filter 190ms ease;
        }

        .performance-page-button {
          min-width: 38px;
          height: 38px;
          padding: 0 10px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          border-radius: 12px;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow: 4px 5px 0 #575092;
          font-size: 10px;
        }

        .performance-page-nav {
          min-width: 78px;
        }

        .performance-page-numbers {
          display: flex;
          align-items: center;
          gap: 5px;
        }

        .performance-page-number {
          width: 36px;
          height: 36px;
          padding: 0;
          display: grid;
          place-items: center;
          border-radius: 11px;
          font-size: 10px;
        }

        .performance-page-number.active {
          border-color: transparent;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow: 3px 4px 0 #575092;
        }

        .performance-page-button:hover:not(:disabled),
        .performance-page-number:hover:not(:disabled) {
          transform: translateY(-2px);
          filter: saturate(1.04);
        }

        .performance-page-button:disabled,
        .performance-page-number:disabled {
          opacity: .52;
          cursor: not-allowed;
          transform: none;
        }

        .performance-page-ellipsis {
          width: 18px;
          text-align: center;
          color: #7b88a5;
          font-weight: 900;
        }

        .performance-page-indicator {
          min-width: 82px;
          color: var(--pf-copy);
          font-size: 10px;
          font-weight: 900;
          text-align: center;
          white-space: nowrap;
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
          border: 1px solid rgba(77,119,221,.22);
          border-radius: 14px;
          color: #4767b4;
          background: linear-gradient(135deg, #f0f5ff 0%, #eefcfb 100%);
          box-shadow: 3px 4px 0 rgba(87,80,146,.12);
          font: inherit;
          font-size: 12px;
          font-weight: 900;
          cursor: pointer;
          transition:
            transform 180ms ease,
            border-color 180ms ease,
            box-shadow 180ms ease;
        }

        .performance-tabs button:hover:not(:disabled) {
          transform: translateY(-1px);
          border-color: rgba(46,178,185,.46);
        }

        .performance-tabs button.active {
          border-color: transparent;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow: 4px 5px 0 #575092;
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
          background: #f5f5ff;
          box-shadow: 5px 6px 0 #c9c0ff;
        }

        .performance-avatar {
          width: 72px;
          height: 72px;
          border-radius: 22px;
          display: grid;
          place-items: center;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
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

        .performance-trend-chart {
          display: grid;
          gap: 12px;
        }

        .performance-trend-row {
          display: grid;
          gap: 12px;
          padding: 15px;
          border: 1px solid rgba(171,181,211,.50);
          border-radius: 16px;
          background: #ffffff;
          transition:
            border-color 180ms ease,
            background 180ms ease;
        }

        .performance-trend-row:hover {
          border-color: rgba(77,119,221,.30);
          background: #fbfcff;
        }

        .performance-trend-label {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          min-width: 0;
        }

        .performance-trend-label > div {
          min-width: 0;
        }

        .performance-trend-label strong {
          display: block;
          color: var(--pf-ink);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .performance-trend-label span {
          display: inline-flex;
          width: max-content;
          max-width: 100%;
          margin-top: 5px;
          padding: 4px 8px;
          border: 1px solid rgba(77,119,221,.14);
          border-radius: 999px;
          color: #5d6785;
          background: #f0f5ff;
          font-size: 10px;
          font-weight: 850;
          line-height: 1.2;
        }

        .performance-trend-value {
          flex: 0 0 auto;
          color: #4767b4 !important;
          font-size: 12px;
          font-weight: 950;
          white-space: nowrap;
        }

        .performance-trend-track {
          width: 100%;
          height: 10px;
          overflow: hidden;
          border-radius: 999px;
          background: #edf1f7;
        }

        .performance-trend-bar {
          height: 100%;
          border-radius: inherit;
          background: linear-gradient(90deg, #4d77dd 0%, #2eb2b9 100%);
          transition: width .34s cubic-bezier(.22, 1, .36, 1);
        }

        .performance-table-wrap {
          overflow-x: auto;
          border: 1px solid rgba(171,181,211,.50);
          border-radius: 18px;
          background: #fff;
          box-shadow: 0 10px 24px rgba(34,38,110,.06);
          overscroll-behavior-x: contain;
          -webkit-overflow-scrolling: touch;
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
          background: #f8f9ff;
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
          color: #4767b4;
          background: #f0f5ff;
          box-shadow: none;
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
          border: 1px dashed rgba(77,119,221,.28);
          border-radius: 20px;
          color: var(--pf-copy);
          background: #f8f9ff;
          box-shadow: none;
        }

        .performance-empty-icon {
          width: 52px;
          height: 52px;
          display: grid;
          place-items: center;
          border-radius: 17px;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow: 3px 4px 0 #b9d7ff;
        }

        .performance-empty h3 {
          margin: 13px 0 7px;
          color: var(--pf-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: 23px;
        }


        @media (max-width: 1180px) {
          .performance-hero {
            grid-template-columns: minmax(0, 1fr);
            min-height: 0;
          }

          .performance-hero-actions {
            justify-content: flex-start;
          }

          .performance-hero-refresh-stack {
            width: min(420px, 100%);
          }

          .performance-section-tab-copy small {
            display: none;
          }
        }

        @media (max-width: 900px) {
          .performance-page {
            gap: 18px;
          }

          .performance-section-tabs {
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 8px;
            padding: 10px;
          }

          .performance-section-tab {
            grid-template-columns: minmax(0, 1fr);
            min-height: 52px;
            padding: 9px 10px;
            text-align: center;
          }

          .performance-section-tab > svg,
          .performance-section-tab-count,
          .performance-section-tab-copy small {
            display: none;
          }

          .performance-section-tab-copy {
            display: block;
            text-align: center;
          }

          .performance-section-tab-copy strong {
            font-size: 11px;
          }
        }

        @media (max-width: 1100px) {
          .performance-layout-grid,
          .performance-history-grid {
            grid-template-columns: 1fr;
          }

          .performance-stats-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .performance-pagination {
            align-items: flex-start;
            flex-direction: column;
          }

          .performance-pagination-controls {
            width: 100%;
            justify-content: flex-start;
          }
        }

        @media (max-width: 760px) {
          .performance-page {
            gap: 14px;
            padding-right: 8px;
            overflow-x: visible;
          }

          .performance-hero {
            grid-template-columns: 1fr;
            min-height: 0;
            padding: 20px;
            border-radius: 26px;
            box-shadow: 6px 7px 0 #b9d7ff, 0 18px 30px rgba(34,38,110,.10);
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
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
          }

          .performance-section-tabs {
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 8px;
            padding: 8px;
            border-radius: 16px;
          }

          .performance-section-tab {
            min-height: 44px;
            padding: 8px 9px;
            border-radius: 11px;
          }

          .performance-section-tab-copy strong {
            font-size: 10.5px;
          }

          .performance-history-controls {
            grid-template-columns: 1fr;
          }

          .performance-page-size-control {
            justify-content: space-between;
          }

          .performance-page-size-control select {
            flex: 1 1 auto;
          }

          .performance-pagination-controls {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            align-items: stretch;
          }

          .performance-page-numbers,
          .performance-page-indicator {
            grid-column: 1 / -1;
            justify-self: stretch;
          }

          .performance-page-numbers {
            justify-content: center;
            flex-wrap: wrap;
          }

          .performance-page-nav {
            width: 100%;
          }

          .performance-panel {
            padding: 16px;
            border-radius: 20px;
            box-shadow: 4px 5px 0 #c4ccff, 0 14px 24px rgba(34,38,110,.08);
          }

          .performance-graph-panel {
            box-shadow: 0 10px 22px rgba(34,38,110,.07);
          }

          .performance-section-head {
            flex-direction: column;
          }

          .performance-trend-label {
            align-items: flex-start;
          }
        }

        @media (max-width: 560px) {
          .performance-section-tabs {
            grid-template-columns: minmax(0, 1fr);
          }

          .performance-section-tab,
          .performance-section-tab-copy {
            text-align: left;
          }

          .performance-hero-actions,
          .performance-hero-refresh-stack,
          .performance-action-stack {
            width: 100%;
          }

          .performance-hero-actions {
            align-items: stretch;
            flex-direction: column;
          }

          .performance-hero-actions .performance-btn {
            width: 100%;
          }

          .performance-trend-label {
            align-items: flex-start;
            flex-direction: column;
            gap: 8px;
          }
        }

        @media (max-width: 430px) {
          .performance-stats-grid {
            grid-template-columns: minmax(0, 1fr);
          }

          .performance-stat-card {
            min-height: 72px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 13px;
          }

          .performance-stat-card strong {
            margin-top: 0;
          }

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

          .performance-hero-actions {
            flex-direction: column;
            align-items: stretch;
          }

          .performance-hero-refresh-stack {
            width: 100%;
          }

          .performance-page-number {
            width: 34px;
            height: 34px;
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
          <div className="performance-hero-refresh-stack">
            <button
              type="button"
              className="performance-btn performance-btn-light"
              onClick={() => loadData({ feedbackScope: 'refresh' })}
              disabled={loading}
            >
              <RefreshCcw
                size={16}
                className={loading ? 'performance-spin' : ''}
              />
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>

            <PerformanceInlineMessage
              type={refreshFeedback.type}
              title={refreshFeedback.title}
              text={refreshFeedback.text}
              loading={refreshFeedback.loading}
              onClose={() =>
                setRefreshFeedback({
                  type: '',
                  title: '',
                  text: '',
                  loading: false,
                })
              }
            />
          </div>

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

      {loadError ? (
        <PerformanceInlineMessage
          type="error"
          title="Performance Load Failed"
          text={loadError}
          onClose={() => setLoadError('')}
        />
      ) : null}

      <section className="performance-stats-grid" aria-label="Performance summary">
        <StatCard
          label="My Average Rating"
          value={`${formatRating(stats.averageRating)} / 5`}
          meta={ratingLabel(stats.averageRating)}
        />
        <StatCard
          label="Reviews Received"
          value={stats.reviewsReceived}
          meta="Performance given to me"
        />
        <StatCard
          label="Reviews Given"
          value={stats.reviewsGiven}
          meta="Submitted by me"
        />
        <StatCard
          label="Reviewable Employees"
          value={stats.reviewable}
          meta={activeMode === 'team_leader' ? 'Team members' : 'Reporting scope'}
        />
      </section>

      <nav
        className="performance-section-tabs"
        aria-label="Performance sections"
      >
        <button
          type="button"
          className={`performance-section-tab ${
            activeSection === 'review' ? 'active' : ''
          }`}
          onClick={() => setActiveSection('review')}
          aria-pressed={activeSection === 'review'}
        >
          <Send size={18} />
          <span className="performance-section-tab-copy">
            <strong>Review Workspace</strong>
            <small>Submit weekly ratings and inspect the selected employee</small>
          </span>
          <span className="performance-section-tab-count">
            {reviewableEmployees.length}
          </span>
        </button>

        <button
          type="button"
          className={`performance-section-tab ${
            activeSection === 'analytics' ? 'active' : ''
          }`}
          onClick={() => setActiveSection('analytics')}
          aria-pressed={activeSection === 'analytics'}
        >
          <BarChart3 size={18} />
          <span className="performance-section-tab-copy">
            <strong>Performance Analytics</strong>
            <small>Weekly, monthly and yearly performance graphs</small>
          </span>
        </button>

        <button
          type="button"
          className={`performance-section-tab ${
            activeSection === 'history' ? 'active' : ''
          }`}
          onClick={() => setActiveSection('history')}
          aria-pressed={activeSection === 'history'}
        >
          <CheckCircle2 size={18} />
          <span className="performance-section-tab-copy">
            <strong>Review History</strong>
            <small>Search and browse received and submitted reviews</small>
          </span>
          <span className="performance-section-tab-count">
            {myReviews.length +
              (reviewsGiven.length ? reviewsGiven.length : reviewHistory.length)}
          </span>
        </button>
      </nav>

      {activeSection === 'review' ? (
        <section className="performance-section-content performance-layout-grid">
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

                <div className="performance-action-stack">
                  <button
                    type="submit"
                    className="performance-btn performance-btn-primary"
                    disabled={saving}
                  >
                    <Send size={16} />
                    {saving ? 'Submitting...' : 'Submit Weekly Rating'}
                  </button>

                  {error ? (
                    <PerformanceInlineMessage
                      type="error"
                      title="Review Submission Failed"
                      text={error}
                      onClose={() => {
                        setError('');
                        setMessage('');
                      }}
                    />
                  ) : message ? (
                    <PerformanceInlineMessage
                      type={reviewFeedbackLoading ? 'info' : 'success'}
                      title={
                        reviewFeedbackLoading
                          ? 'Submitting Review'
                          : 'Review Submitted'
                      }
                      text={message}
                      loading={reviewFeedbackLoading}
                      onClose={() => {
                        setMessage('');
                        setError('');
                        setReviewFeedbackLoading(false);
                      }}
                    />
                  ) : null}
                </div>
              </form>
            )}
          </section>

          <section className="performance-panel">
            <div className="performance-section-head">
              <div>
                <span className="performance-kicker">Selected Employee</span>
                <h2>
                  {selectedEmployee
                    ? selectedEmployee.employee_name
                    : 'No Employee Selected'}
                </h2>
                <p>
                  {selectedEmployee
                    ? `${selectedEmployee.review_scope_label} • ${
                        selectedEmployee.department || 'Department not set'
                      } • ${
                        selectedEmployee.designation || 'Designation not set'
                      }`
                    : 'Choose an employee from the form to view details.'}
                </p>
              </div>
            </div>

            {selectedEmployee ? (
              <div className="performance-profile-card">
                <div className="performance-avatar">
                  {String(selectedEmployee.employee_name || 'E')
                    .slice(0, 2)
                    .toUpperCase()}
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
      ) : null}

      {activeSection === 'analytics' ? (
        <div className="performance-section-content">
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
            subtitle="Performance trend for weekly, monthly and yearly review analytics."
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
        </div>
      ) : null}

      {activeSection === 'history' ? (
        <div className="performance-section-content performance-history-grid">
          <ReviewHistory title="Reviews Received By Me" reviews={myReviews} />
          <ReviewHistory
            title="Reviews Submitted By Me"
            reviews={reviewsGiven.length ? reviewsGiven : reviewHistory}
          />
        </div>
      ) : null}

    </main>
  );
}