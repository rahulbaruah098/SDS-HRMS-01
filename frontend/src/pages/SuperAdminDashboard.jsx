import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { allModules } from '../data/modules';
import Stat from '../components/Stat';
import Table from '../components/Table';
import ModuleGrid from '../components/ModuleGrid';

export default function SuperAdminDashboard() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api('/dashboard/superadmin').then(setData).catch(console.error);
  }, []);

  return (
    <div className="page-grid">
      <section className="hero">
        <div>
          <span className="kicker">Platform Super Admin</span>
          <h1>Complete HRMS Control Center</h1>
          <p>
            Create companies, manage every tenant, reset any user password, change designations, edit complete user
            profiles, monitor all modules and audit every action across the SaaS platform.
          </p>
        </div>
        <div className="hero-actions">
          <button className="primary">Create Company</button>
          <button className="secondary">Manage Users</button>
        </div>
      </section>

      <section className="stats-grid">
        {Object.entries(data?.stats || {}).map(([key, value]) => (
          <Stat key={key} label={key} value={value} />
        ))}
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

      <ModuleGrid modules={allModules.slice(0, 12)} />
    </div>
  );
}
