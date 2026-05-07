import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { moduleList } from '../data/modules';
import Stat from '../components/Stat';
import Table from '../components/Table';
import MiniList from '../components/MiniList';
import ModuleGrid from '../components/ModuleGrid';

export default function AdminDashboard({ user, setPage }) {
  const [data, setData] = useState(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    setMessage('');

    api('/dashboard/admin')
      .then(setData)
      .catch((error) => {
        console.error(error);
        setMessage(error.message || 'Unable to load dashboard data');
      })
      .finally(() => setLoading(false));
  }, []);

  function goTo(page) {
    if (typeof setPage === 'function') {
      setPage(page);
    }
  }

  const allowedModules = moduleList(user || {}).filter(
    ([key]) => !['profile'].includes(key)
  );

  const stats = data?.stats || {};
  const recentEmployees = data?.recent_employees || [];
  const recentAttendance = data?.recent_attendance || [];
  const departmentSummary = data?.department_summary || [];
  const designationSummary = data?.designation_summary || [];

  return (
    <div className="page-grid">
      <section className="hero">
        <div>
          <span className="kicker">Admin Dashboard</span>
          <h1>HRMS Operations Dashboard</h1>
          <p>
            Employee control, attendance overview, leave approvals, payroll,
            recruitment, grievance, policies, reports and audit-ready HR
            operations.
          </p>
        </div>

        <div className="hero-actions">
          <button
            type="button"
            className="primary"
            onClick={() => goTo('employees')}
          >
            Employee Master
          </button>

          <button
            type="button"
            className="secondary"
            onClick={() => goTo('departments')}
          >
            Departments
          </button>

          <button
            type="button"
            className="secondary"
            onClick={() => goTo('designations')}
          >
            Designations
          </button>

          <button
            type="button"
            className="secondary"
            onClick={() => goTo('attendance')}
          >
            Attendance
          </button>
        </div>
      </section>

      {message && <div className="inline-message">{message}</div>}

      <section className="stats-grid">
        {Object.entries(stats).map(([key, value]) => (
          <Stat key={key} label={key} value={value} />
        ))}

        {loading && (
          <div className="panel">
            <p>Loading dashboard...</p>
          </div>
        )}

        {!loading && !message && !Object.keys(stats).length && (
          <div className="panel">
            <p>No dashboard stats available.</p>
          </div>
        )}
      </section>

      <section className="two-col">
        <div className="panel">
          <h3>Recent Employees</h3>
          <Table rows={recentEmployees} />
        </div>

        <div className="panel">
          <h3>Recent Attendance</h3>
          <Table rows={recentAttendance} />
        </div>
      </section>

      <section className="two-col">
        <div className="panel">
          <h3>Department Summary</h3>
          <Table rows={departmentSummary} />
        </div>

        <div className="panel">
          <h3>Designation Summary</h3>
          <Table rows={designationSummary} />
        </div>
      </section>

      <section className="two-col">
        <div className="panel">
          <h3>Pending Approvals</h3>

          <MiniList
            title="Leave Requests"
            rows={data?.pending?.leave_requests || []}
          />

          <MiniList
            title="Expenses"
            rows={data?.pending?.expenses || []}
          />

          <MiniList
            title="Tickets"
            rows={data?.pending?.tickets || []}
          />
        </div>

        <div className="panel">
          <h3>Quick Actions</h3>

          <div className="mini-list">
            <button
              type="button"
              className="secondary"
              onClick={() => goTo('employees')}
            >
              Open Employee Master
            </button>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('departments')}
            >
              Manage Departments
            </button>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('designations')}
            >
              Manage Designations
            </button>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('leave_requests')}
            >
              Review Leave Requests
            </button>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('expenses')}
            >
              Review Expenses
            </button>
          </div>
        </div>
      </section>

      <ModuleGrid modules={allowedModules} setPage={setPage} />
    </div>
  );
}