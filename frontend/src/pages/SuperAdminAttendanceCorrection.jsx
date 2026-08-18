import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock3,
  DatabaseZap,
  LockKeyhole,
  MapPin,
  RefreshCcw,
  Save,
  Search,
  ShieldAlert,
  UserRound,
} from 'lucide-react';
import {
  getPrivateAttendanceCorrectionEmployees,
  getPrivateAttendanceCorrectionRecord,
  getPrivateAttendanceCorrectionTenants,
  savePrivateAttendanceCorrection,
} from '../api/client';
import { useCustomAlert } from '../components/CustomAlertProvider.jsx';

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
  const alerts = useCustomAlert();
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
  const [messageTone, setMessageTone] = useState('info');

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
      setMessageTone('info');

      const data = await getPrivateAttendanceCorrectionTenants();
      setTenants(data.items || data.tenants || []);
    } catch (error) {
      setMessage(error.message || 'Unable to load tenants');
      setMessageTone('error');
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
      setMessageTone('warning');
      return;
    }

    try {
      setLoadingEmployees(true);
      setMessage('');
      setMessageTone('info');
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
      setMessageTone('error');
    } finally {
      setLoadingEmployees(false);
    }
  }

  async function loadAttendanceRecord(employee = selectedEmployee) {
    if (!form.tenant_id) {
      setMessage('Select tenant first');
      setMessageTone('warning');
      return;
    }

    if (!employee?._id) {
      setMessage('Select employee first');
      setMessageTone('warning');
      return;
    }

    if (!form.date) {
      setMessage('Select attendance date');
      setMessageTone('warning');
      return;
    }

    try {
      setLoadingRecord(true);
      setMessage('');
      setMessageTone('info');
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
        setMessageTone('info');
      }
    } catch (error) {
      setMessage(error.message || 'Unable to load attendance record');
      setMessageTone('error');
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
    setMessageTone('info');
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
      const validationMessage = 'Select tenant first';
      setMessage(validationMessage);
      setMessageTone('warning');
      alerts.warning(validationMessage, 'Tenant Required');
      return;
    }

    if (!selectedEmployee?._id) {
      const validationMessage = 'Select employee first';
      setMessage(validationMessage);
      setMessageTone('warning');
      alerts.warning(validationMessage, 'Employee Required');
      return;
    }

    if (!form.date) {
      const validationMessage = 'Select attendance date';
      setMessage(validationMessage);
      setMessageTone('warning');
      alerts.warning(validationMessage, 'Attendance Date Required');
      return;
    }

    if (!form.check_in) {
      const validationMessage = 'Check-in time is required';
      setMessage(validationMessage);
      setMessageTone('warning');
      alerts.warning(validationMessage, 'Check-In Required');
      return;
    }

    const ok = await alerts.confirm(
      `Save private attendance correction for ${selectedEmployee.name || selectedEmployee.employee_name || 'this employee'} on ${form.date}?`,
      {
        title: 'Confirm Attendance Correction',
        confirmText: 'Save Correction',
        cancelText: 'Cancel',
      },
    );

    if (!ok) {
      return;
    }

    try {
      setSaving(true);
      setMessage('');
      setMessageTone('info');

      const data = await savePrivateAttendanceCorrection({
        attendance_id: loadedRecord?._id || '',
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

      if (!data.record?._id) {
        throw new Error('The server did not return the saved attendance record.');
      }

      const verification = await getPrivateAttendanceCorrectionRecord({
        attendance_id: data.record._id,
        tenant_id: form.tenant_id,
        employee_id: selectedEmployee._id,
        date: form.date,
      });

      const verifiedRecord = verification.record || data.record;
      const requestedCheckIn = normalizeTimeForInput(form.check_in);
      const verifiedCheckIn = normalizeTimeForInput(
        verifiedRecord?.check_in || verifiedRecord?.check_in_at,
      );

      if (!verifiedRecord?._id || requestedCheckIn !== verifiedCheckIn) {
        throw new Error('Attendance was not updated to the selected check-in time.');
      }

      setLoadedRecord(verifiedRecord);
      setForm((current) => ({
        ...current,
        mode: verifiedRecord.mode || current.mode || 'office',
        check_in: verifiedCheckIn,
        check_out: normalizeTimeForInput(
          verifiedRecord.check_out || verifiedRecord.check_out_at,
        ),
        check_in_location: normalizeLocationForInput(verifiedRecord.check_in_location),
        check_out_location: normalizeLocationForInput(verifiedRecord.check_out_location),
        late_reason: verifiedRecord.late_reason || '',
        early_checkout_reason: verifiedRecord.early_checkout_reason || '',
        remarks: verifiedRecord.remarks || '',
      }));

      const successMessage = data.message || 'Attendance correction saved successfully';
      setMessage(successMessage);
      setMessageTone('success');
      alerts.success(successMessage, 'Attendance Updated');
    } catch (error) {
      const errorMessage = error.message || 'Unable to save correction';
      setMessage(errorMessage);
      setMessageTone('error');
      alerts.error(errorMessage, 'Attendance Correction Failed');
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    loadTenants();
  }, []);

  return (
    <div className="page-grid sac-page">
      <style>{`
        .sac-page {
          --sac-navy: #101640;
          --sac-indigo: #4f46e5;
          --sac-violet: #7c3aed;
          --sac-cyan: #06b6d4;
          --sac-ink: #172033;
          --sac-muted: #667085;
          --sac-line: #e7e9f3;
          --sac-soft: #f7f8fc;
          gap: 20px;
          max-width: 1480px;
          margin: 0 auto;
          padding-bottom: 28px;
        }

        .sac-page * { box-sizing: border-box; }

        .sac-hero {
          position: relative;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 28px;
          overflow: hidden;
          min-height: 250px;
          padding: 36px;
          border: 1px solid rgba(255, 255, 255, .12);
          border-radius: 26px;
          color: #fff;
          background:
            radial-gradient(circle at 86% 18%, rgba(34, 211, 238, .28), transparent 24%),
            radial-gradient(circle at 12% 100%, rgba(168, 85, 247, .34), transparent 34%),
            linear-gradient(135deg, #101640 0%, #272166 48%, #4c1d95 100%);
          box-shadow: 0 24px 55px rgba(26, 24, 84, .22);
        }

        .sac-hero::after {
          content: '';
          position: absolute;
          right: -72px;
          bottom: -104px;
          width: 310px;
          height: 310px;
          border: 44px solid rgba(255, 255, 255, .06);
          border-radius: 50%;
        }

        .sac-hero-copy,
        .sac-hero-actions { position: relative; z-index: 1; }

        .sac-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 18px;
          padding: 8px 12px;
          border: 1px solid rgba(255, 255, 255, .22);
          border-radius: 999px;
          color: #e0e7ff;
          background: rgba(255, 255, 255, .1);
          font-size: 12px;
          font-weight: 800;
          letter-spacing: .08em;
          text-transform: uppercase;
          backdrop-filter: blur(12px);
        }

        .sac-hero h1 {
          margin: 0;
          max-width: 760px;
          color: #fff;
          font-size: clamp(31px, 4vw, 48px);
          line-height: 1.06;
          letter-spacing: -.04em;
        }

        .sac-hero-copy > p {
          max-width: 720px;
          margin: 16px 0 0;
          color: rgba(235, 238, 255, .82);
          font-size: 15px;
          line-height: 1.75;
        }

        .sac-security-strip {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 24px;
        }

        .sac-security-strip span {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 8px 11px;
          border-radius: 10px;
          color: #fff;
          background: rgba(255, 255, 255, .09);
          font-size: 12px;
          font-weight: 700;
        }

        .sac-hero-actions {
          display: flex;
          flex-direction: column;
          gap: 10px;
          min-width: 170px;
        }

        .sac-hero-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-height: 44px;
          padding: 10px 15px;
          border: 1px solid rgba(255, 255, 255, .22);
          border-radius: 12px;
          color: #fff;
          background: rgba(255, 255, 255, .1);
          font-weight: 750;
          cursor: pointer;
          backdrop-filter: blur(12px);
          transition: transform .2s ease, background .2s ease;
        }

        .sac-hero-button:hover:not(:disabled) {
          transform: translateY(-2px);
          background: rgba(255, 255, 255, .18);
        }

        .sac-hero-button:disabled { opacity: .6; cursor: not-allowed; }

        .sac-progress {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
          padding: 12px;
          border: 1px solid var(--sac-line);
          border-radius: 18px;
          background: #fff;
          box-shadow: 0 10px 28px rgba(31, 36, 76, .07);
        }

        .sac-step {
          display: flex;
          align-items: center;
          gap: 11px;
          min-height: 62px;
          padding: 11px 13px;
          border-radius: 13px;
          color: var(--sac-muted);
          background: var(--sac-soft);
        }

        .sac-step.active {
          color: #3730a3;
          background: #eef2ff;
        }

        .sac-step.complete {
          color: #047857;
          background: #ecfdf5;
        }

        .sac-step-number {
          display: grid;
          flex: 0 0 32px;
          width: 32px;
          height: 32px;
          place-items: center;
          border-radius: 10px;
          color: #fff;
          background: #98a2b3;
          font-size: 12px;
          font-weight: 900;
        }

        .sac-step.active .sac-step-number { background: var(--sac-indigo); }
        .sac-step.complete .sac-step-number { background: #059669; }
        .sac-step strong { display: block; color: inherit; font-size: 13px; }
        .sac-step small { display: block; margin-top: 2px; color: inherit; opacity: .76; font-size: 11px; }

        .sac-feedback {
          display: flex;
          align-items: center;
          gap: 11px;
          padding: 14px 16px;
          border: 1px solid #bfdbfe;
          border-radius: 14px;
          color: #1e40af;
          background: #eff6ff;
          font-weight: 700;
        }

        .sac-feedback.success { border-color: #a7f3d0; color: #047857; background: #ecfdf5; }
        .sac-feedback.warning { border-color: #fde68a; color: #92400e; background: #fffbeb; }
        .sac-feedback.error { border-color: #fecaca; color: #b42318; background: #fef2f2; }

        .sac-card {
          overflow: hidden;
          padding: 0 !important;
          border: 1px solid var(--sac-line) !important;
          border-radius: 22px !important;
          background: #fff !important;
          box-shadow: 0 12px 34px rgba(31, 36, 76, .07) !important;
        }

        .sac-card-body { padding: 24px; }

        .sac-section-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          padding: 20px 24px;
          border-bottom: 1px solid var(--sac-line);
          background: linear-gradient(180deg, #fff, #fbfbfe);
        }

        .sac-section-title { display: flex; align-items: center; gap: 13px; }

        .sac-section-icon {
          display: grid;
          flex: 0 0 42px;
          width: 42px;
          height: 42px;
          place-items: center;
          border-radius: 13px;
          color: var(--sac-indigo);
          background: #eef2ff;
        }

        .sac-section-head h2 { margin: 0; color: var(--sac-ink); font-size: 18px; letter-spacing: -.02em; }
        .sac-section-head p { margin: 4px 0 0; color: var(--sac-muted); font-size: 13px; }

        .sac-private-badge {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 8px 11px;
          border: 1px solid #fed7aa;
          border-radius: 999px;
          color: #9a3412;
          background: #fff7ed;
          font-size: 11px;
          font-weight: 850;
          text-transform: uppercase;
          letter-spacing: .05em;
        }

        .sac-page .sac-form-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 18px;
        }

        .sac-page .sac-form-grid + .sac-form-grid { margin-top: 18px; }

        .sac-page label {
          display: flex;
          flex-direction: column;
          gap: 8px;
          color: #344054;
          font-size: 12px;
          font-weight: 800;
        }

        .sac-page input,
        .sac-page select,
        .sac-page textarea {
          width: 100%;
          min-height: 46px;
          padding: 11px 13px;
          border: 1px solid #d9ddea;
          border-radius: 12px;
          outline: none;
          color: var(--sac-ink);
          background: #fff;
          font: inherit;
          font-weight: 600;
          transition: border-color .18s ease, box-shadow .18s ease;
        }

        .sac-page textarea { min-height: 96px; resize: vertical; }
        .sac-page input:focus, .sac-page select:focus, .sac-page textarea:focus {
          border-color: #818cf8;
          box-shadow: 0 0 0 4px rgba(99, 102, 241, .12);
        }

        .sac-page input:disabled { color: #98a2b3; background: #f2f4f7; }

        .sac-search-field { grid-column: 1 / -1; }
        .sac-search-wrap { display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: end; }

        .sac-primary-button,
        .sac-secondary-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-height: 44px;
          padding: 10px 15px;
          border-radius: 12px;
          font-weight: 800;
          cursor: pointer;
          transition: transform .18s ease, box-shadow .18s ease, opacity .18s ease;
        }

        .sac-primary-button {
          border: 1px solid transparent;
          color: #fff;
          background: linear-gradient(135deg, var(--sac-indigo), var(--sac-violet));
          box-shadow: 0 10px 20px rgba(79, 70, 229, .2);
        }

        .sac-secondary-button {
          border: 1px solid #d9ddea;
          color: #344054;
          background: #fff;
        }

        .sac-primary-button:hover:not(:disabled),
        .sac-secondary-button:hover:not(:disabled) { transform: translateY(-1px); }
        .sac-primary-button:disabled, .sac-secondary-button:disabled { opacity: .52; cursor: not-allowed; }

        .sac-selection-note {
          display: flex;
          align-items: center;
          gap: 9px;
          margin: 18px 0 0;
          padding: 11px 13px;
          border-radius: 11px;
          color: #3730a3;
          background: #f3f4ff;
          font-size: 12px;
        }

        .sac-table-wrap { overflow-x: auto; padding: 10px 18px 20px; }
        .sac-table-wrap table { width: 100%; border-collapse: separate; border-spacing: 0 8px; }
        .sac-table-wrap th { padding: 8px 13px; color: #667085; font-size: 11px; text-align: left; text-transform: uppercase; letter-spacing: .06em; }
        .sac-table-wrap td { padding: 14px 13px; border-top: 1px solid #eef0f6; border-bottom: 1px solid #eef0f6; background: #fbfcfe; font-size: 13px; }
        .sac-table-wrap td:first-child { border-left: 1px solid #eef0f6; border-radius: 13px 0 0 13px; }
        .sac-table-wrap td:last-child { border-right: 1px solid #eef0f6; border-radius: 0 13px 13px 0; }
        .sac-table-wrap tr.selected td { border-color: #c7d2fe; background: #eef2ff; }
        .sac-employee-name { display: flex; align-items: center; gap: 10px; font-weight: 800; color: var(--sac-ink); }
        .sac-avatar { display: grid; width: 34px; height: 34px; place-items: center; border-radius: 11px; color: #4338ca; background: #e0e7ff; }
        .sac-empty { padding: 40px 20px !important; border: 0 !important; border-radius: 14px !important; color: #98a2b3; background: #fafbfc !important; text-align: center; }

        .sac-selected-employee {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 17px 20px;
          border: 1px solid #c7d2fe;
          border-radius: 16px;
          color: #312e81;
          background: linear-gradient(135deg, #eef2ff, #f5f3ff);
        }

        .sac-selected-employee .sac-avatar { width: 44px; height: 44px; background: #fff; }
        .sac-selected-employee strong { display: block; font-size: 14px; }
        .sac-selected-employee span { display: block; margin-top: 3px; color: #6366a5; font-size: 12px; }

        .sac-summary-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
          margin: 18px 0 22px;
        }

        .sac-stat {
          display: flex;
          align-items: center;
          gap: 12px;
          min-height: 88px;
          padding: 16px;
          border: 1px solid var(--sac-line);
          border-radius: 15px;
          background: #fbfcfe;
        }

        .sac-stat-icon { display: grid; width: 38px; height: 38px; place-items: center; border-radius: 12px; color: #4338ca; background: #eef2ff; }
        .sac-stat span { display: block; color: var(--sac-muted); font-size: 11px; font-weight: 700; }
        .sac-stat strong { display: block; margin-top: 4px; color: var(--sac-ink); font-size: 16px; text-transform: capitalize; }

        .sac-form-heading {
          grid-column: 1 / -1;
          display: flex;
          align-items: center;
          gap: 9px;
          margin-top: 3px;
          padding-bottom: 10px;
          border-bottom: 1px solid var(--sac-line);
          color: #344054;
          font-size: 13px;
          font-weight: 900;
          letter-spacing: .02em;
        }

        .sac-time-field input {
          color: #312e81;
          border-color: #c7d2fe;
          background: #f8f7ff;
          font-size: 17px;
          font-weight: 850;
        }

        .sac-full { grid-column: 1 / -1; }

        .sac-time-note {
          display: flex;
          align-items: flex-start;
          gap: 9px;
          grid-column: 1 / -1;
          margin: 0;
          padding: 12px 13px;
          border: 1px solid #bae6fd;
          border-radius: 12px;
          color: #0c4a6e;
          background: #f0f9ff;
          font-size: 12px;
          line-height: 1.55;
        }

        .sac-action-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          grid-column: 1 / -1;
          margin-top: 4px;
          padding: 15px;
          border: 1px solid var(--sac-line);
          border-radius: 15px;
          background: #fafaff;
        }

        .sac-action-copy strong { display: block; color: var(--sac-ink); font-size: 12px; }
        .sac-action-copy span { display: block; margin-top: 3px; color: var(--sac-muted); font-size: 11px; }
        .sac-action-buttons { display: flex; flex-wrap: wrap; gap: 9px; }

        .sac-access-note {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
          padding: 19px 22px;
          border: 1px solid #ddd6fe;
          border-radius: 18px;
          color: #4c1d95;
          background: linear-gradient(135deg, #faf5ff, #f5f3ff);
        }

        .sac-access-copy { display: flex; align-items: center; gap: 12px; }
        .sac-access-copy strong { display: block; font-size: 13px; }
        .sac-access-copy span { display: block; margin-top: 3px; color: #7c6ca6; font-size: 12px; }

        @media (max-width: 900px) {
          .sac-hero { flex-direction: column; padding: 28px; }
          .sac-hero-actions { flex-direction: row; width: 100%; }
          .sac-hero-button { flex: 1; }
          .sac-progress { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .sac-summary-grid { grid-template-columns: 1fr; }
        }

        @media (max-width: 680px) {
          .sac-page { gap: 14px; }
          .sac-hero { min-height: auto; padding: 23px 19px; border-radius: 20px; }
          .sac-hero-actions, .sac-search-wrap, .sac-action-bar, .sac-access-note { flex-direction: column; align-items: stretch; }
          .sac-progress { grid-template-columns: 1fr; }
          .sac-page .sac-form-grid, .sac-search-wrap { display: grid; grid-template-columns: 1fr; }
          .sac-section-head { align-items: flex-start; padding: 17px; }
          .sac-card-body { padding: 17px; }
          .sac-private-badge { display: none; }
          .sac-action-buttons { display: grid; grid-template-columns: 1fr; }
          .sac-table-wrap { padding-inline: 10px; }
        }
      `}</style>

      <section className="sac-hero">
        <div className="sac-hero-copy">
          <span className="sac-eyebrow">
            <LockKeyhole size={14} /> Private Super Admin Workspace
          </span>
          <h1>Attendance Correction Console</h1>
          <p>
            Securely locate an employee, load the exact attendance record and correct
            check-in, check-out, mode, location and supporting notes from one controlled workspace.
          </p>

          <div className="sac-security-strip">
            <span><ShieldAlert size={14} /> Super Admin only</span>
            <span><DatabaseZap size={14} /> Exact-record verification</span>
            <span><BadgeCheck size={14} /> Correction audit trail</span>
          </div>
        </div>

        <div className="sac-hero-actions">
          <button
            type="button"
            className="sac-hero-button"
            onClick={loadTenants}
            disabled={loadingTenants}
          >
            <RefreshCcw size={16} />
            {loadingTenants ? 'Refreshing...' : 'Refresh Data'}
          </button>
          <button
            type="button"
            className="sac-hero-button"
            onClick={() => setPage?.('dashboard')}
          >
            <ArrowLeft size={16} /> Dashboard
          </button>
        </div>
      </section>

      <section className="sac-progress" aria-label="Correction progress">
        <div className={`sac-step ${form.tenant_id ? 'complete' : 'active'}`}>
          <span className="sac-step-number">01</span>
          <div><strong>Select company</strong><small>Choose tenant and date</small></div>
        </div>
        <div className={`sac-step ${selectedEmployee ? 'complete' : form.tenant_id ? 'active' : ''}`}>
          <span className="sac-step-number">02</span>
          <div><strong>Find employee</strong><small>Search the employee master</small></div>
        </div>
        <div className={`sac-step ${loadedRecord ? 'complete' : selectedEmployee ? 'active' : ''}`}>
          <span className="sac-step-number">03</span>
          <div><strong>Load record</strong><small>Open exact attendance entry</small></div>
        </div>
        <div className={`sac-step ${selectedEmployee ? 'active' : ''}`}>
          <span className="sac-step-number">04</span>
          <div><strong>Verify and save</strong><small>Apply audited correction</small></div>
        </div>
      </section>

      {message && (
        <div className={`sac-feedback ${messageTone}`}>
          {messageTone === 'success' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          <span>{message}</span>
        </div>
      )}

      <section className="panel sac-card">
        <header className="sac-section-head">
          <div className="sac-section-title">
            <span className="sac-section-icon"><Building2 size={20} /></span>
            <div>
              <h2>Company and attendance date</h2>
              <p>Begin by choosing the tenant and the date that needs correction.</p>
            </div>
          </div>
          <span className="sac-private-badge"><LockKeyhole size={13} /> Restricted</span>
        </header>

        <div className="sac-card-body">
          <div className="sac-form-grid">
            <label>
              Company / Tenant
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

          <form className="sac-form-grid" onSubmit={searchEmployees}>
            <div className="sac-search-field sac-search-wrap">
              <label>
                Employee Search
                <input
                  value={form.employee_search}
                  onChange={(event) => updateForm('employee_search', event.target.value)}
                  placeholder="Search by name, employee ID, email, department or designation"
                  disabled={!form.tenant_id}
                />
              </label>
              <button
                type="submit"
                className="sac-primary-button"
                disabled={loadingEmployees || !form.tenant_id}
              >
                <Search size={16} />
                {loadingEmployees ? 'Searching...' : 'Search Employee'}
              </button>
            </div>
          </form>

          {selectedTenant && (
            <p className="sac-selection-note">
              <CheckCircle2 size={15} /> Selected company:
              <strong>{tenantLabel(selectedTenant)}</strong>
            </p>
          )}
        </div>
      </section>

      <section className="panel sac-card">
        <header className="sac-section-head">
          <div className="sac-section-title">
            <span className="sac-section-icon"><UserRound size={20} /></span>
            <div>
              <h2>Employee results</h2>
              <p>Select one employee to load the attendance entry for the chosen date.</p>
            </div>
          </div>
          {employees.length ? <span className="sac-private-badge">{employees.length} result(s)</span> : null}
        </header>

        <div className="sac-table-wrap">
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
                <tr
                  key={employee._id}
                  className={selectedEmployee?._id === employee._id ? 'selected' : ''}
                >
                  <td>
                    <div className="sac-employee-name">
                      <span className="sac-avatar"><UserRound size={16} /></span>
                      {employeeLabel(employee)}
                    </div>
                  </td>
                  <td>{employee.department || '—'}</td>
                  <td>{employee.designation || '—'}</td>
                  <td>{employee.email || '—'}</td>
                  <td>
                    <button
                      type="button"
                      className="sac-secondary-button"
                      onClick={() => selectEmployee(employee)}
                      disabled={loadingRecord}
                    >
                      {loadingRecord && selectedEmployee?._id === employee._id
                        ? 'Loading...'
                        : selectedEmployee?._id === employee._id
                          ? 'Selected'
                          : 'Select'}
                    </button>
                  </td>
                </tr>
              ))}

              {!employees.length && (
                <tr>
                  <td colSpan="5" className="sac-empty">
                    Select a company and search to display employee records.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selectedEmployee && (
        <section className="panel sac-card">
          <header className="sac-section-head">
            <div className="sac-section-title">
              <span className="sac-section-icon"><DatabaseZap size={20} /></span>
              <div>
                <h2>Review and correct attendance</h2>
                <p>Changes are applied to the exact loaded record and verified after saving.</p>
              </div>
            </div>
            <button
              type="button"
              className="sac-secondary-button"
              onClick={() => loadAttendanceRecord(selectedEmployee)}
              disabled={loadingRecord}
            >
              <CalendarDays size={16} />
              {loadingRecord ? 'Loading...' : 'Reload Record'}
            </button>
          </header>

          <div className="sac-card-body">
            <div className="sac-selected-employee">
              <span className="sac-avatar"><UserRound size={19} /></span>
              <div>
                <strong>{employeeLabel(selectedEmployee)}</strong>
                <span>{selectedEmployee.email || 'No email'} · Attendance date {form.date}</span>
              </div>
            </div>

            <div className="sac-summary-grid">
              <div className="sac-stat">
                <span className="sac-stat-icon"><BadgeCheck size={18} /></span>
                <div><span>Current status</span><strong>{loadedRecord?.status || 'No record'}</strong></div>
              </div>
              <div className="sac-stat">
                <span className="sac-stat-icon"><Clock3 size={18} /></span>
                <div><span>Stored check-in</span><strong>{readableRecordTime(loadedRecord?.check_in)}</strong></div>
              </div>
              <div className="sac-stat">
                <span className="sac-stat-icon"><Clock3 size={18} /></span>
                <div><span>Stored check-out</span><strong>{readableRecordTime(loadedRecord?.check_out)}</strong></div>
              </div>
            </div>

            <form className="sac-form-grid" onSubmit={saveCorrection}>
              <div className="sac-form-heading"><Clock3 size={16} /> Attendance session</div>

              <label>
                Attendance Mode
                <select value={form.mode} onChange={(event) => updateForm('mode', event.target.value)}>
                  <option value="office">Office</option>
                  <option value="wfh">WFH</option>
                  <option value="field">Field</option>
                </select>
              </label>

              <label className="sac-time-field">
                Corrected Check-In Time
                <input
                  type="time"
                  value={form.check_in}
                  onChange={(event) => updateForm('check_in', event.target.value)}
                  required
                />
              </label>

              <label className="sac-time-field">
                Corrected Check-Out Time
                <input
                  type="time"
                  value={form.check_out}
                  onChange={(event) => updateForm('check_out', event.target.value)}
                />
              </label>

              <p className="sac-time-note">
                <Clock3 size={16} />
                <span>
                  Enter any valid local time. There is no past/future time restriction.
                  If check-out is earlier than check-in, it is saved as an overnight
                  check-out on the following day.
                </span>
              </p>

              <div className="sac-form-heading"><MapPin size={16} /> Location and operational notes</div>

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

              <label className="sac-full">
                Internal Remarks
                <input
                  value={form.remarks}
                  onChange={(event) => updateForm('remarks', event.target.value)}
                  placeholder="Optional internal attendance note"
                />
              </label>

              <div className="sac-form-heading"><ShieldAlert size={16} /> Correction audit</div>

              <label className="sac-full">
                Correction Reason
                <textarea
                  value={form.correction_reason}
                  onChange={(event) => updateForm('correction_reason', event.target.value)}
                  placeholder="Example: Corrected server timezone mismatch / authorised manual correction"
                  rows={3}
                />
              </label>

              <div className="sac-action-bar">
                <div className="sac-action-copy">
                  <strong>Ready to apply this correction?</strong>
                  <span>The server will save and verify the exact attendance record.</span>
                </div>
                <div className="sac-action-buttons">
                  <button
                    type="button"
                    className="sac-secondary-button"
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
                    Clear Employee
                  </button>
                  <button
                    type="submit"
                    className="sac-primary-button"
                    disabled={saving || loadingRecord}
                  >
                    <Save size={16} />
                    {saving ? 'Saving and verifying...' : 'Save Attendance Correction'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </section>
      )}

      <section className="sac-access-note">
        <div className="sac-access-copy">
          <span className="sac-section-icon"><LockKeyhole size={19} /></span>
          <div>
            <strong>Private route protection is active</strong>
            <span>This console remains hidden from the sidebar and accessible only to Super Admin.</span>
          </div>
        </div>
        <button type="button" className="sac-secondary-button" onClick={() => setPage?.('dashboard')}>
          <ArrowLeft size={16} /> Back to Dashboard
        </button>
      </section>
    </div>
  );
}
