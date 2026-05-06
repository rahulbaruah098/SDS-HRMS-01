import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { allModules } from '../data/modules';
import Stat from '../components/Stat';
import Table from '../components/Table';
import MiniList from '../components/MiniList';
import ModuleGrid from '../components/ModuleGrid';

export default function AdminDashboard({ setPage }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    api('/dashboard/admin').then(setData).catch(console.error);
  }, []);

  return (
    <div className="page-grid">
      <section className="hero">
        <div>
          <span className="kicker">Admin Dashboard</span>
          <h1>HRMS Operations Dashboard</h1>
          <p>
            Employee control, attendance overview, leave approvals, payroll, recruitment, grievance, policies, reports and
            audit-ready HR operations.
          </p>
        </div>
      </section>

      <section className="stats-grid">
        {Object.entries(data?.stats || {}).map(([key, value]) => (
          <Stat key={key} label={key} value={value} />
        ))}
      </section>

      <section className="two-col">
        <div className="panel">
          <h3>Recent Attendance</h3>
          <Table rows={data?.recent_attendance || []} />
        </div>
        <div className="panel">
          <h3>Pending Approvals</h3>
          <MiniList title="Leave Requests" rows={data?.pending?.leave_requests || []} />
          <MiniList title="Expenses" rows={data?.pending?.expenses || []} />
          <MiniList title="Tickets" rows={data?.pending?.tickets || []} />
        </div>
      </section>

     <ModuleGrid modules={allModules.slice(0, 14)} setPage={setPage} />
    </div>
  );
}
