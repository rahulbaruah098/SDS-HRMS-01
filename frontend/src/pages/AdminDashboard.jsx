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

  useEffect(() => {
    api('/dashboard/admin')
      .then(setData)
      .catch((error) => {
        console.error(error);
        setMessage(error.message || 'Unable to load dashboard data');
      });
  }, []);

  function goTo(page) {
    if (typeof setPage === 'function') {
      setPage(page);
    }
  }

  const allowedModules = moduleList(user || {}).filter(
    ([key]) => !['profile'].includes(key)
  );

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
            onClick={() => goTo('attendance')}
          >
            Attendance
          </button>
        </div>
      </section>

      {message && <div className="inline-message">{message}</div>}

      <section className="stats-grid">
        {Object.entries(data?.stats || {}).map(([key, value]) => (
          <Stat key={key} label={key} value={value} />
        ))}

        {!data && !message && (
          <div className="panel">
            <p>Loading dashboard...</p>
          </div>
        )}
      </section>

      <section className="two-col">
        <div className="panel">
          <h3>Recent Attendance</h3>
          <Table rows={data?.recent_attendance || []} />
        </div>

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
      </section>

      <ModuleGrid modules={allowedModules} setPage={setPage} />
    </div>
  );
}