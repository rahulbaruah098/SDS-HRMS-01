import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { roles } from '../utils/authHelpers';
import AttendanceWidget from '../components/AttendanceWidget';
import Table from '../components/Table';

export default function Attendance() {
  const [myAttendance, setMyAttendance] = useState([]);
  const [report, setReport] = useState([]);
  const [message, setMessage] = useState('');
  const [filters, setFilters] = useState({
    employee_id: '',
    department: '',
    date_from: '',
    date_to: '',
  });

  const canViewReport = roles().some((role) =>
    [
      'super_admin',
      'admin',
      'hr_admin',
      'hr_manager',
      'hr',
      'manager',
      'ro',
      'team_leader',
      'reporting_officer',
    ].includes(role)
  );

  async function loadMyAttendance() {
    try {
      const data = await api('/attendance/my');
      setMyAttendance(data.items || []);
    } catch (error) {
      setMessage(error.message || 'Unable to load your attendance');
    }
  }

  async function loadReport(nextFilters = filters) {
    if (!canViewReport) {
      return;
    }

    try {
      const params = [];

      if (nextFilters.employee_id.trim()) {
        params.push(`employee_id=${encodeURIComponent(nextFilters.employee_id.trim())}`);
      }

      if (nextFilters.department.trim()) {
        params.push(`department=${encodeURIComponent(nextFilters.department.trim())}`);
      }

      if (nextFilters.date_from.trim()) {
        params.push(`date_from=${encodeURIComponent(nextFilters.date_from.trim())}`);
      }

      if (nextFilters.date_to.trim()) {
        params.push(`date_to=${encodeURIComponent(nextFilters.date_to.trim())}`);
      }

      const data = await api(
        `/attendance/report${params.length ? `?${params.join('&')}` : ''}`
      );

      setReport(data.items || []);
    } catch (error) {
      setMessage(error.message || 'Unable to load attendance report');
    }
  }

  useEffect(() => {
    loadMyAttendance();

    if (canViewReport) {
      loadReport();
    }
  }, [canViewReport]);

  async function searchReport(e) {
    e.preventDefault();
    await loadReport(filters);
  }

  async function clearReportFilters() {
    const cleared = {
      employee_id: '',
      department: '',
      date_from: '',
      date_to: '',
    };

    setFilters(cleared);
    await loadReport(cleared);
  }

  async function verifyAttendance(row) {
    const attendanceId = row?._id;

    if (!attendanceId) {
      setMessage('Attendance id not found');
      return;
    }

    try {
      const data = await api(`/attendance/${attendanceId}/verify`, {
        method: 'PATCH',
        body: JSON.stringify({}),
      });

      setMessage(data.message || 'Attendance verified');
      await loadReport();
    } catch (error) {
      setMessage(error.message || 'Unable to verify attendance');
    }
  }

  const reportRows = report.map((row) => ({
    ...row,
    action: row.verified_by_ro ? (
      'Verified'
    ) : (
      <button
        type="button"
        className="secondary"
        onClick={() => verifyAttendance(row)}
      >
        Verify
      </button>
    ),
  }));

  return (
    <div className="page-grid">
      <section className="hero compact">
        <div>
          <span className="kicker">Office + Field</span>
          <h1>Attendance Management</h1>
          <p>
            Check-in/check-out, field mode, late reason after 09:45 AM, RO
            verification and reports.
          </p>
        </div>

        <AttendanceWidget />
      </section>

      {message && <div className="inline-message">{message}</div>}

      <section className="two-col">
        <div className="panel">
          <h3>My Attendance</h3>
          <Table rows={myAttendance} />
        </div>

        {canViewReport && (
          <div className="panel">
            <h3>Attendance Report</h3>

            <form className="dynamic-form" onSubmit={searchReport}>
              <label>
                Employee ID
                <input
                  value={filters.employee_id}
                  onChange={(e) =>
                    setFilters({ ...filters, employee_id: e.target.value })
                  }
                  placeholder="Employee Mongo ID"
                />
              </label>

              <label>
                Department
                <input
                  value={filters.department}
                  onChange={(e) =>
                    setFilters({ ...filters, department: e.target.value })
                  }
                  placeholder="Department"
                />
              </label>

              <label>
                Date From
                <input
                  type="date"
                  value={filters.date_from}
                  onChange={(e) =>
                    setFilters({ ...filters, date_from: e.target.value })
                  }
                />
              </label>

              <label>
                Date To
                <input
                  type="date"
                  value={filters.date_to}
                  onChange={(e) =>
                    setFilters({ ...filters, date_to: e.target.value })
                  }
                />
              </label>

              <button type="submit" className="primary">
                Search
              </button>

              <button
                type="button"
                className="secondary"
                onClick={clearReportFilters}
              >
                Clear
              </button>
            </form>

            <Table rows={reportRows} />
          </div>
        )}
      </section>
    </div>
  );
}