import { useEffect, useMemo, useState } from 'react';
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

function getRoles(user = {}, employee = {}) {
  const rawRoles = [];

  if (Array.isArray(user.roles)) rawRoles.push(...user.roles);
  if (user.role) rawRoles.push(user.role);
  if (Array.isArray(employee.roles)) rawRoles.push(...employee.roles);
  if (employee.role) rawRoles.push(employee.role);

  if (isTruthy(employee.is_team_leader) || employee.is_team_leader === true) {
    rawRoles.push('team_leader');
  }

  if (isTruthy(employee.is_reporting_officer) || employee.is_reporting_officer === true) {
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
      <div className="performance-empty-icon">📊</div>
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
  const roles = useMemo(() => getRoles(user, employee), [user, employee]);

  const isTeamLeader =
    roles.includes('team_leader') ||
    isTruthy(employee?.is_team_leader) ||
    employee?.is_team_leader === true;

  const isReportingOfficer =
    roles.includes('reporting_officer') ||
    roles.includes('ro') ||
    isTruthy(employee?.is_reporting_officer) ||
    employee?.is_reporting_officer === true;

  const canAccess = isTeamLeader || isReportingOfficer;

  const teamMembers = Array.isArray(dashboard.team_members) ? dashboard.team_members : [];
  const reportingMembers = Array.isArray(dashboard.reporting_members)
    ? dashboard.reporting_members
    : [];

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
    () => reviewableEmployees.find((item) => item.employee_id === form.employee_id),
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
      return (
        dashboard.monthly_performance_chart ||
        dashboard.performance_3d_graph ||
        dashboard.my_performance_chart ||
        dashboard.team_member_weekly_graph ||
        dashboard.reporting_team_leader_weekly_graph ||
        reviewHistory ||
        {}
      );
    }

    if (graphMode === 'yearly') {
      return (
        dashboard.yearly_performance_chart ||
        dashboard.performance_3d_graph ||
        dashboard.my_performance_chart ||
        dashboard.team_member_weekly_graph ||
        dashboard.reporting_team_leader_weekly_graph ||
        reviewHistory ||
        {}
      );
    }

    return (
      dashboard.weekly_performance_chart ||
      dashboard.performance_3d_graph ||
      dashboard.team_member_weekly_graph ||
      dashboard.reporting_team_leader_weekly_graph ||
      dashboard.team_performance_chart ||
      dashboard.reporting_performance_chart ||
      dashboard.my_performance_chart ||
      reviewHistory ||
      {}
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

      const availableModes = [];
      if (isTeamLeader) availableModes.push('team_leader');
      if (isReportingOfficer) availableModes.push('reporting_officer');

      const defaultMode = availableModes.includes(activeMode)
        ? activeMode
        : availableModes[0] || 'team_leader';

      setActiveMode(defaultMode);

      const defaultReviewable = buildUniqueReviewableEmployees(
        dashboardData?.team_members || [],
        dashboardData?.reporting_members || [],
        defaultMode,
      );

      setForm((prev) => {
        const existingStillValid = defaultReviewable.some(
          (item) => item.employee_id === prev.employee_id,
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

    const stillExists = reviewableEmployees.some((item) => item.employee_id === form.employee_id);

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

  if (!canAccess) {
    return (
      <main className="performance-page">
        <section className="performance-hero">
          <div>
            <span className="performance-kicker">Restricted Module</span>
            <h1>Performance Reviews</h1>
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
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="performance-page">
      <section className="performance-hero">
        <div>
          <span className="performance-kicker">Weekly Performance Rating</span>
          <h1>Team Performance Review</h1>
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
            Refresh
          </button>
          <button
            type="button"
            className="performance-btn performance-btn-primary"
            onClick={() => setPage?.('dashboard')}
          >
            Dashboard
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
          chart={
            dashboard.team_member_weekly_graph ||
            dashboard.team_performance_chart ||
            dashboard.weekly_performance_chart ||
            reviewHistory ||
            {}
          }
        />
      ) : null}

      {isReportingOfficer ? (
        <PerformanceGraph
          title="Reporting Officer Team Leader Graph"
          subtitle="Team Leader and reporting member performance visible employee-wise."
          chart={
            dashboard.reporting_team_leader_weekly_graph ||
            dashboard.reporting_performance_chart ||
            dashboard.weekly_performance_chart ||
            reviewHistory ||
            {}
          }
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