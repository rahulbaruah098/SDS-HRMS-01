import { useEffect, useState } from 'react';
import { api } from '../api/client';
import AttendanceWidget from '../components/AttendanceWidget';
import Stat from '../components/Stat';
import Table from '../components/Table';

export default function EmployeeDashboard({ setPage }) {
  const [data, setData] = useState(null);
  const [reviewForm, setReviewForm] = useState({
    employee_id: '',
    cycle: '',
    rating: 5,
    comments: '',
  });
  const [message, setMessage] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);

  async function loadDashboard() {
    try {
      const dashboardData = await api('/dashboard/employee');
      setData(dashboardData);
    } catch (error) {
      console.error(error);
      setMessage(error.message || 'Unable to load employee dashboard');
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  function goTo(page) {
    if (typeof setPage === 'function') {
      setPage(page);
    }
  }

  function getRoleLabel() {
    const labels = [];

    if (data?.is_team_leader) {
      labels.push('Team Leader');
    }

    if (data?.is_reporting_officer) {
      labels.push('Reporting Officer');
    }

    if (!labels.length) {
      labels.push('Employee');
    }

    return labels.join(' + ');
  }

  async function submitReview(e) {
    e.preventDefault();
    setMessage('');

    if (!reviewForm.employee_id) {
      setMessage('Please select an employee to review');
      return;
    }

    const ratingValue = Number(reviewForm.rating);

    if (!ratingValue || ratingValue < 1 || ratingValue > 5) {
      setMessage('Rating must be between 1 and 5');
      return;
    }

    try {
      setSubmittingReview(true);

      const res = await api('/performance/reviews', {
        method: 'POST',
        body: JSON.stringify({
          ...reviewForm,
          rating: ratingValue,
        }),
      });

      setMessage(res.message || 'Performance review submitted');

      setReviewForm({
        employee_id: '',
        cycle: '',
        rating: 5,
        comments: '',
      });

      await loadDashboard();
    } catch (error) {
      setMessage(error.message || 'Unable to submit performance review');
    } finally {
      setSubmittingReview(false);
    }
  }

  const roleLabel = getRoleLabel();

  const reviewableEmployeesMap = new Map();

  [...(data?.team_members || []), ...(data?.reporting_members || [])].forEach((emp) => {
    if (emp?._id) {
      reviewableEmployeesMap.set(emp._id, emp);
    }
  });

  const reviewableEmployees = Array.from(reviewableEmployeesMap.values());

  return (
    <div className="page-grid">
      <section className="hero employee-hero">
        <div>
          <span className="kicker">Employee Self Service</span>

          <h1>Welcome, {data?.employee?.name || 'Employee'}</h1>

          <p>
            Current Role: <b>{roleLabel}</b>
          </p>

          <p>
            Check attendance, apply leave, view payslips, raise tickets, and
            track notifications.
          </p>

          <div className="hero-actions">
            <button
              type="button"
              className="primary"
              onClick={() => goTo('attendance')}
            >
              Attendance
            </button>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('leave_requests')}
            >
              Apply Leave
            </button>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('tickets')}
            >
              Raise Ticket
            </button>
          </div>
        </div>

        <AttendanceWidget onSuccess={loadDashboard} />
      </section>

      {message && <div className="inline-message">{message}</div>}

      <section className="stats-grid">
        <Stat label="Dashboard Role" value={roleLabel} />

        <Stat
          label="Today Status"
          value={data?.today_attendance?.status || 'Not checked-in'}
        />

        <Stat label="Team Members" value={data?.team_members?.length || 0} />

        <Stat
          label="Reporting Members"
          value={data?.reporting_members?.length || 0}
        />

        {!data && !message && (
          <div className="panel">
            <p>Loading dashboard...</p>
          </div>
        )}
      </section>

      {(data?.is_team_leader || data?.is_reporting_officer) && (
        <section className="panel">
          <h3>Performance Rating</h3>
          <p>Team Leader / Reporting Officer can rate assigned employees only.</p>

          <form className="dynamic-form" onSubmit={submitReview}>
            <label>
              Employee
              <select
                value={reviewForm.employee_id}
                onChange={(e) =>
                  setReviewForm({
                    ...reviewForm,
                    employee_id: e.target.value,
                  })
                }
                disabled={submittingReview}
              >
                <option value="">Select employee</option>

                {reviewableEmployees.map((emp) => (
                  <option key={emp._id} value={emp._id}>
                    {emp.name} — {emp.designation || emp.department || emp.email}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Cycle
              <input
                value={reviewForm.cycle}
                placeholder="May 2026"
                onChange={(e) =>
                  setReviewForm({
                    ...reviewForm,
                    cycle: e.target.value,
                  })
                }
                disabled={submittingReview}
              />
            </label>

            <label>
              Rating 1 to 5
              <input
                type="number"
                min="1"
                max="5"
                value={reviewForm.rating}
                onChange={(e) =>
                  setReviewForm({
                    ...reviewForm,
                    rating: e.target.value,
                  })
                }
                disabled={submittingReview}
              />
            </label>

            <label>
              Comments
              <input
                value={reviewForm.comments}
                onChange={(e) =>
                  setReviewForm({
                    ...reviewForm,
                    comments: e.target.value,
                  })
                }
                disabled={submittingReview}
              />
            </label>

            <button
              type="submit"
              className="primary"
              disabled={submittingReview}
            >
              {submittingReview ? 'Submitting...' : 'Submit Rating'}
            </button>
          </form>
        </section>
      )}

      <section className="two-col">
        <div className="panel">
          <h3>My Team Members</h3>
          <Table rows={data?.team_members || []} />
        </div>

        <div className="panel">
          <h3>My Reporting Members</h3>
          <Table rows={data?.reporting_members || []} />
        </div>
      </section>

      <section className="panel">
        <h3>My Performance Reviews</h3>
        <p>This is visible to the employee, HR, and MD/Super Admin.</p>
        <Table rows={data?.my_performance_reviews || []} />
      </section>

      <section className="two-col">
        <div className="panel">
          <h3>My Leaves</h3>
          <Table rows={data?.leaves || []} />
        </div>

        <div className="panel">
          <h3>My Tickets</h3>
          <Table rows={data?.tickets || []} />
        </div>
      </section>
    </div>
  );
}