import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { allModules } from '../data/modules';
import Stat from '../components/Stat';
import Table from '../components/Table';
import ModuleGrid from '../components/ModuleGrid';

export default function SuperAdminDashboard({ setPage }) {
  const [data, setData] = useState(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    api('/dashboard/superadmin')
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
          <h3>Companies / Tenants</h3>
          <Table rows={data?.tenants || []} />
        </div>

        <div className="panel">
          <h3>Recent Audit</h3>
          <Table rows={data?.recent_audit || []} />
        </div>
      </section>

      <ModuleGrid modules={allModules.slice(0, 12)} setPage={setPage} />
    </div>
  );
}