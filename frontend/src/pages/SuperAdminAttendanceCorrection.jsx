import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  Clock3,
  RefreshCcw,
  Save,
  Search,
  ShieldAlert,
} from 'lucide-react';
import {
  getPrivateAttendanceCorrectionEmployees,
  getPrivateAttendanceCorrectionRecord,
  getPrivateAttendanceCorrectionTenants,
  savePrivateAttendanceCorrection,
} from '../api/client';

const EMPTY_FORM = {
  tenant_id: '',
  employee_id: '',
  employee_search: '',
  date: new Date().toISOString().slice(0, 10),
  mode: 'office',
  check_in: '',
  check_out: '',
  check_in_location: '',
  check_out_location: '',
  late_reason: '',
  early_checkout_reason: '',
  remarks: '',
  correction_reason: '',
};

function tenantLabel(row = {}) {
  return (
    row.name ||
    row.company_name ||
    row.tenant_name ||
    row.tenant_id ||
    row._id ||
    'Unnamed Tenant'
  );
}

function employeeLabel(row = {}) {
  const name = row.name || row.employee_name || 'Unnamed Employee';
  const code = row.employee_id || row.employee_code || row.emp_code || row.code || '';
  const department = row.department || '';
  const designation = row.designation || '';

  const meta = [code, department, designation].filter(Boolean).join(' · ');

  return meta ? `${name} (${meta})` : name;
}

function normalizeTimeForInput(value = '') {
  const raw = String(value || '').trim();

  if (!raw) {
    return '';
  }

  const twentyFourMatch = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);

  if (twentyFourMatch) {
    const hour = String(twentyFourMatch[1]).padStart(2, '0');
    const minute = twentyFourMatch[2];

    return `${hour}:${minute}`;
  }

  const twelveHourMatch = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);

  if (twelveHourMatch) {
    let hour = Number(twelveHourMatch[1]);
    const minute = twelveHourMatch[2];
    const meridiem = twelveHourMatch[3].toUpperCase();

    if (meridiem === 'PM' && hour < 12) {
      hour += 12;
    }

    if (meridiem === 'AM' && hour === 12) {
      hour = 0;
    }

    return `${String(hour).padStart(2, '0')}:${minute}`;
  }

  const parsed = new Date(raw);

  if (!Number.isNaN(parsed.getTime())) {
    return `${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}`;
  }

  return '';
}

function readableRecordTime(value = '') {
  const raw = String(value || '').trim();

  if (!raw) {
    return '—';
  }

  return raw;
}

function normalizeLocationForInput(value) {
  if (!value) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'object') {
    const address = value.address || value.place || value.location || value.name || '';
    const latitude = value.latitude || value.lat || '';
    const longitude = value.longitude || value.lng || value.lon || '';

    if (address && latitude && longitude) {
      return `${address} (${latitude}, ${longitude})`;
    }

    if (address) {
      return address;
    }

    if (latitude && longitude) {
      return `${latitude}, ${longitude}`;
    }

    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }

  return String(value);
}

export default function SuperAdminAttendanceCorrection({ setPage }) {
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [tenants, setTenants] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [loadedRecord, setLoadedRecord] = useState(null);
  const [loadingTenants, setLoadingTenants] = useState(false);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [loadingRecord, setLoadingRecord] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const selectedTenant = useMemo(() => {
    return tenants.find((tenant) => {
      const value = tenant.tenant_id || tenant._id;

      return String(value || '') === String(form.tenant_id || '');
    });
  }, [tenants, form.tenant_id]);

  async function loadTenants() {
    try {
      setLoadingTenants(true);
      setMessage('');

      const data = await getPrivateAttendanceCorrectionTenants();
      setTenants(data.items || data.tenants || []);
    } catch (error) {
      setMessage(error.message || 'Unable to load tenants');
    } finally {
      setLoadingTenants(false);
    }
  }

  async function searchEmployees(event) {
    if (event) {
      event.preventDefault();
    }

    if (!form.tenant_id) {
      setMessage('Select tenant first');
      return;
    }

    try {
      setLoadingEmployees(true);
      setMessage('');
      setEmployees([]);
      setSelectedEmployee(null);
      setLoadedRecord(null);

      const data = await getPrivateAttendanceCorrectionEmployees({
        tenant_id: form.tenant_id,
        q: form.employee_search,
      });

      setEmployees(data.items || data.employees || []);
    } catch (error) {
      setMessage(error.message || 'Unable to search employees');
    } finally {
      setLoadingEmployees(false);
    }
  }

  async function loadAttendanceRecord(employee = selectedEmployee) {
    if (!form.tenant_id) {
      setMessage('Select tenant first');
      return;
    }

    if (!employee?._id) {
      setMessage('Select employee first');
      return;
    }

    if (!form.date) {
      setMessage('Select attendance date');
      return;
    }

    try {
      setLoadingRecord(true);
      setMessage('');
      setLoadedRecord(null);

      const data = await getPrivateAttendanceCorrectionRecord({
        tenant_id: form.tenant_id,
        employee_id: employee._id,
        date: form.date,
      });

      const record = data.record || null;

      setSelectedEmployee(data.employee || employee);
      setLoadedRecord(record);

      setForm((current) => ({
        ...current,
        employee_id: employee._id,
        mode: record?.mode || current.mode || 'office',
        check_in: normalizeTimeForInput(record?.check_in || record?.check_in_at),
        check_out: normalizeTimeForInput(record?.check_out || record?.check_out_at),
        check_in_location: normalizeLocationForInput(record?.check_in_location),
        check_out_location: normalizeLocationForInput(record?.check_out_location),
        late_reason: record?.late_reason || '',
        early_checkout_reason: record?.early_checkout_reason || '',
        remarks: record?.remarks || '',
      }));

      if (!record) {
        setMessage('No attendance record found for this date. Saving will create one.');
      }
    } catch (error) {
      setMessage(error.message || 'Unable to load attendance record');
    } finally {
      setLoadingRecord(false);
    }
  }

  function updateForm(key, value) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function resetEmployeeState(nextTenantId = form.tenant_id) {
    setForm((current) => ({
      ...current,
      tenant_id: nextTenantId,
      employee_id: '',
      employee_search: '',
      mode: 'office',
      check_in: '',
      check_out: '',
      check_in_location: '',
      check_out_location: '',
      late_reason: '',
      early_checkout_reason: '',
      remarks: '',
      correction_reason: '',
    }));

    setEmployees([]);
    setSelectedEmployee(null);
    setLoadedRecord(null);
    setMessage('');
  }

  function selectEmployee(employee) {
    setSelectedEmployee(employee);
    setLoadedRecord(null);

    setForm((current) => ({
      ...current,
      employee_id: employee._id,
      employee_search: employee.name || employee.employee_name || '',
      mode: 'office',
      check_in: '',
      check_out: '',
      check_in_location: '',
      check_out_location: '',
      late_reason: '',
      early_checkout_reason: '',
      remarks: '',
      correction_reason: current.correction_reason,
    }));

    setTimeout(() => {
      loadAttendanceRecord(employee);
    }, 0);
  }

  async function saveCorrection(event) {
    event.preventDefault();

    if (!form.tenant_id) {
      setMessage('Select tenant first');
      return;
    }

    if (!selectedEmployee?._id) {
      setMessage('Select employee first');
      return;
    }

    if (!form.date) {
      setMessage('Select attendance date');
      return;
    }

    if (!form.check_in) {
      setMessage('Check-in time is required');
      return;
    }

    const ok = window.confirm(
      `Save private attendance correction for ${selectedEmployee.name || selectedEmployee.employee_name || 'this employee'} on ${form.date}?`,
    );

    if (!ok) {
      return;
    }

    try {
      setSaving(true);
      setMessage('');

      const data = await savePrivateAttendanceCorrection({
        tenant_id: form.tenant_id,
        employee_id: selectedEmployee._id,
        date: form.date,
        mode: form.mode,
        check_in: form.check_in,
        check_out: form.check_out,
        check_in_location: form.check_in_location,
        check_out_location: form.check_out_location,
        late_reason: form.late_reason,
        early_checkout_reason: form.early_checkout_reason,
        remarks: form.remarks,
        correction_reason: form.correction_reason,
      });

      setLoadedRecord(data.record || null);
      setMessage(data.message || 'Attendance correction saved successfully');
    } catch (error) {
      setMessage(error.message || 'Unable to save correction');
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    loadTenants();
  }, []);

  return (
    <div className="page-grid">
      <section className="hero compact">
        <div>
          <span className="kicker">Super Admin Private Tool</span>
          <h1>Attendance Correction</h1>
          <p>
            Hidden Super Admin-only attendance correction panel. This page is not added
            to sidebar or normal employee/admin workflows.
          </p>
        </div>

        <button
          type="button"
          className="secondary"
          onClick={loadTenants}
          disabled={loadingTenants}
        >
          <RefreshCcw size={16} />
          {loadingTenants ? 'Refreshing...' : 'Refresh'}
        </button>
      </section>

      {message && (
        <div className="alert">
          <AlertTriangle size={16} />
          <span>{message}</span>
        </div>
      )}

      <section className="panel">
        <div className="toolbar">
          <div>
            <h3>Private Filters</h3>
            <p>Select tenant, search employee, then load attendance for a date.</p>
          </div>

          <div className="pill warning">
            <ShieldAlert size={14} />
            Super Admin only
          </div>
        </div>

        <div className="form-grid">
          <label>
            Tenant
            <select
              value={form.tenant_id}
              onChange={(event) => resetEmployeeState(event.target.value)}
            >
              <option value="">Select tenant</option>
              {tenants.map((tenant) => {
                const value = tenant.tenant_id || tenant._id;

                return (
                  <option key={tenant._id || value} value={value}>
                    {tenantLabel(tenant)}
                  </option>
                );
              })}
            </select>
          </label>

          <label>
            Attendance Date
            <input
              type="date"
              value={form.date}
              onChange={(event) => {
                updateForm('date', event.target.value);
                setLoadedRecord(null);
              }}
            />
          </label>
        </div>

        <form className="form-grid" onSubmit={searchEmployees}>
          <label>
            Employee Search
            <input
              value={form.employee_search}
              onChange={(event) => updateForm('employee_search', event.target.value)}
              placeholder="Search by name, employee ID, email, department..."
              disabled={!form.tenant_id}
            />
          </label>

          <div className="form-actions">
            <button
              type="submit"
              className="primary"
              disabled={loadingEmployees || !form.tenant_id}
            >
              <Search size={16} />
              {loadingEmployees ? 'Searching...' : 'Search Employee'}
            </button>
          </div>
        </form>

        {selectedTenant && (
          <p className="muted">
            Selected tenant: <strong>{tenantLabel(selectedTenant)}</strong>
          </p>
        )}
      </section>

      <section className="panel">
        <div className="toolbar">
          <div>
            <h3>Employees</h3>
            <p>Choose the employee whose attendance needs correction.</p>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Department</th>
                <th>Designation</th>
                <th>Email</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {employees.map((employee) => (
                <tr key={employee._id}>
                  <td>{employeeLabel(employee)}</td>
                  <td>{employee.department || '—'}</td>
                  <td>{employee.designation || '—'}</td>
                  <td>{employee.email || '—'}</td>
                  <td>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => selectEmployee(employee)}
                      disabled={loadingRecord}
                    >
                      {loadingRecord && selectedEmployee?._id === employee._id
                        ? 'Loading...'
                        : 'Select'}
                    </button>
                  </td>
                </tr>
              ))}

              {!employees.length && (
                <tr>
                  <td colSpan="5" className="empty-state">
                    Search employees after selecting a tenant.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selectedEmployee && (
        <section className="panel">
          <div className="toolbar">
            <div>
              <h3>Edit Attendance</h3>
              <p>
                {employeeLabel(selectedEmployee)} · {form.date}
              </p>
            </div>

            <button
              type="button"
              className="secondary"
              onClick={() => loadAttendanceRecord(selectedEmployee)}
              disabled={loadingRecord}
            >
              <CalendarDays size={16} />
              {loadingRecord ? 'Loading...' : 'Reload Record'}
            </button>
          </div>

          <div className="summary-grid">
            <div className="stat-card">
              <span>Status</span>
              <strong>{loadedRecord?.status || 'No Record'}</strong>
            </div>

            <div className="stat-card">
              <span>Current Check-In</span>
              <strong>{readableRecordTime(loadedRecord?.check_in)}</strong>
            </div>

            <div className="stat-card">
              <span>Current Check-Out</span>
              <strong>{readableRecordTime(loadedRecord?.check_out)}</strong>
            </div>
          </div>

          <form className="form-grid" onSubmit={saveCorrection}>
            <label>
              Attendance Mode
              <select
                value={form.mode}
                onChange={(event) => updateForm('mode', event.target.value)}
              >
                <option value="office">Office</option>
                <option value="wfh">WFH</option>
                <option value="field">Field</option>
              </select>
            </label>

            <label>
              Check-In Time
              <input
                type="time"
                value={form.check_in}
                onChange={(event) => updateForm('check_in', event.target.value)}
                required
              />
            </label>

            <label>
              Check-Out Time
              <input
                type="time"
                value={form.check_out}
                onChange={(event) => updateForm('check_out', event.target.value)}
              />
            </label>

            <label>
              Check-In Location
              <input
                value={form.check_in_location}
                onChange={(event) => updateForm('check_in_location', event.target.value)}
                placeholder="Example: SDS Head Office"
              />
            </label>

            <label>
              Check-Out Location
              <input
                value={form.check_out_location}
                onChange={(event) => updateForm('check_out_location', event.target.value)}
                placeholder="Example: SDS Head Office"
              />
            </label>

            <label>
              Late Reason
              <input
                value={form.late_reason}
                onChange={(event) => updateForm('late_reason', event.target.value)}
                placeholder="Optional"
              />
            </label>

            <label>
              Early Checkout Reason
              <input
                value={form.early_checkout_reason}
                onChange={(event) => updateForm('early_checkout_reason', event.target.value)}
                placeholder="Optional"
              />
            </label>

            <label>
              Internal Remarks
              <input
                value={form.remarks}
                onChange={(event) => updateForm('remarks', event.target.value)}
                placeholder="Optional"
              />
            </label>

            <label style={{ gridColumn: '1 / -1' }}>
              Correction Reason
              <textarea
                value={form.correction_reason}
                onChange={(event) => updateForm('correction_reason', event.target.value)}
                placeholder="Example: Corrected server timezone mismatch / manual HR correction"
                rows={3}
              />
            </label>

            <div className="form-actions">
              <button
                type="submit"
                className="primary"
                disabled={saving || loadingRecord}
              >
                <Save size={16} />
                {saving ? 'Saving...' : 'Save Attendance Correction'}
              </button>

              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setSelectedEmployee(null);
                  setLoadedRecord(null);
                  setForm((current) => ({
                    ...current,
                    employee_id: '',
                    mode: 'office',
                    check_in: '',
                    check_out: '',
                    check_in_location: '',
                    check_out_location: '',
                    late_reason: '',
                    early_checkout_reason: '',
                    remarks: '',
                    correction_reason: '',
                  }));
                }}
              >
                Clear Selected Employee
              </button>
            </div>
          </form>

          <p className="muted">
            <Clock3 size={14} /> Time should be entered in local attendance time.
          </p>
        </section>
      )}

      <section className="panel subtle">
        <div className="toolbar">
          <div>
            <h3>Access Note</h3>
            <p>
              This tool is intentionally not added in the sidebar. It will be available
              only through the private Super Admin route after File 4 is added.
            </p>
          </div>
        </div>

        <button
          type="button"
          className="secondary"
          onClick={() => setPage?.('dashboard')}
        >
          Back to Dashboard
        </button>
      </section>
    </div>
  );
}