import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { roles } from '../utils/authHelpers';
import AttendanceWidget from '../components/AttendanceWidget';
import Table from '../components/Table';

export default function Attendance() {
  const [myAttendance, setMyAttendance] = useState([]);
  const [report, setReport] = useState([]);
  const canViewReport = roles().some((role) => ['super_admin', 'admin', 'hr_manager', 'hr', 'manager'].includes(role));

  useEffect(() => {
    api('/attendance/my').then((data) => setMyAttendance(data.items || [])).catch(console.error);
    if (canViewReport) {
      api('/attendance/report').then((data) => setReport(data.items || [])).catch(console.error);
    }
  }, [canViewReport]);

  return (
    <div className="page-grid">
      <section className="hero compact">
        <div>
          <span className="kicker">Office + Field</span>
          <h1>Attendance Management</h1>
          <p>Check-in/check-out, field mode, late reason after 09:45 AM, RO verification and reports.</p>
        </div>
        <AttendanceWidget />
      </section>

      <section className="two-col">
        <div className="panel">
          <h3>My Attendance</h3>
          <Table rows={myAttendance} />
        </div>
        {canViewReport && (
          <div className="panel">
            <h3>Attendance Report</h3>
            <Table rows={report} />
          </div>
        )}
      </section>
    </div>
  );
}
