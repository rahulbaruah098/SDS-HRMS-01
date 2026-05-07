import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { allModules } from '../data/modules';
import Stat from '../components/Stat';
import Table from '../components/Table';
import ModuleGrid from '../components/ModuleGrid';

export default function SuperAdminDashboard({ setPage }) {
  const [data, setData] = useState(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    setMessage('');

    api('/dashboard/superadmin')
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

  const stats = data?.stats || {};
  const tenants = data?.tenants || [];
  const recentUsers = data?.recent_users || [];
  const recentAudit = data?.recent_audit || [];

  const dashboardModules = allModules.filter(
    ([key]) => !['profile'].includes(key)
  );

  return (
    <div className="page-grid">
      <section className="hero">
        <div>
          <span className="kicker">Platform Super Admin</span>
          <h1>Complete HRMS Control Center</h1>
          <p>
            Create companies, manage every tenant, reset any user password,
            change designations, edit complete user profiles, monitor all
            modules and audit every action across the SaaS platform.
          </p>
        </div>

        <div className="hero-actions">
          <button
            type="button"
            className="primary"
            onClick={() => goTo('companies')}
          >
            Create Company
          </button>

          <button
            type="button"
            className="secondary"
            onClick={() => goTo('users')}
          >
            Manage Users
          </button>

          <button
            type="button"
            className="secondary"
            onClick={() => goTo('password_requests')}
          >
            Password Requests
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
          <h3>Companies / Tenants</h3>
          <Table rows={tenants} />
        </div>

        <div className="panel">
          <h3>Recent Users</h3>
          <Table rows={recentUsers} />
        </div>
      </section>

      <section className="two-col">
        <div className="panel">
          <h3>Recent Audit</h3>
          <Table rows={recentAudit} />
        </div>

        <div className="panel">
          <h3>Quick Actions</h3>

          <div className="mini-list">
            <button
              type="button"
              className="secondary"
              onClick={() => goTo('companies')}
            >
              Manage Companies / Tenants
            </button>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('users')}
            >
              Manage Users
            </button>

            <button
              type="button"
              className="secondary"
              onClick={() => goTo('employees')}
            >
              Employee Master
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
              onClick={() => goTo('password_requests')}
            >
              Review Password Requests
            </button>
          </div>
        </div>
      </section>

      <ModuleGrid modules={dashboardModules.slice(0, 12)} setPage={setPage} />
    </div>
  );
}