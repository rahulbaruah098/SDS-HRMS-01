import { useEffect, useState } from 'react';
import { api } from '../api/client';
import AttendanceWidget from '../components/AttendanceWidget';
import Stat from '../components/Stat';
import Table from '../components/Table';

export default function EmployeeDashboard() {
  const [data, setData] = useState(null);
  const [reviewForm, setReviewForm] = useState({
    employee_id: '',
    cycle: '',
    rating: 5,
    comments: '',
  });
  const [message, setMessage] = useState('');

  useEffect(() => {
    api('/dashboard/employee').then(setData).catch(console.error);
  }, []);

  async function submitReview(e) {
    e.preventDefault();

    try {
      const res = await api('/performance/reviews', {
        method: 'POST',
        body: JSON.stringify(reviewForm),
      });

      setMessage(res.message || 'Performance review submitted');
      setReviewForm({
        employee_id: '',
        cycle: '',
        rating: 5,
        comments: '',
      });

      const fresh = await api('/dashboard/employee');
      setData(fresh);
    } catch (error) {
      setMessage(error.message);
    }
  }

  const roleLabel = data?.is_team_leader
    ? 'Team Leader'
    : data?.is_reporting_officer
      ? 'Reporting Officer'
      : 'Employee';

  const reviewableEmployees = [
    ...(data?.team_members || []),
    ...(data?.reporting_members || []),
  ];

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
            Check attendance, apply leave, view payslips, raise tickets, and track notifications.
          </p>
        </div>
        <AttendanceWidget />
      </section>

      <section className="stats-grid">
        <Stat label="Dashboard Role" value={roleLabel} />
        <Stat label="Today Status" value={data?.today_attendance?.status || 'Not checked-in'} />
        <Stat label="Team Members" value={data?.team_members?.length || 0} />
        <Stat label="Reporting Members" value={data?.reporting_members?.length || 0} />
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
                onChange={(e) => setReviewForm({ ...reviewForm, employee_id: e.target.value })}
              >
                <option value="">Select employee</option>
                {reviewableEmployees.map((emp) => (
                  <option key={emp._id} value={emp._id}>
                    {emp.name} — {emp.designation}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Cycle
              <input
                value={reviewForm.cycle}
                placeholder="May 2026"
                onChange={(e) => setReviewForm({ ...reviewForm, cycle: e.target.value })}
              />
            </label>

            <label>
              Rating 1 to 5
              <input
                type="number"
                min="1"
                max="5"
                value={reviewForm.rating}
                onChange={(e) => setReviewForm({ ...reviewForm, rating: e.target.value })}
              />
            </label>

            <label>
              Comments
              <input
                value={reviewForm.comments}
                onChange={(e) => setReviewForm({ ...reviewForm, comments: e.target.value })}
              />
            </label>

            <button className="primary">Submit Rating</button>
          </form>

          {message && <div className="inline-message">{message}</div>}
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