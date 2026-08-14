import { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  Filter,
  RefreshCcw,
  Search,
  XCircle,
} from 'lucide-react';
import {
  getLeaveRequestReports,
  getActiveEmployees,
  downloadCsv,
} from '../api/client';
import { useCustomAlert } from '../components/CustomAlertProvider.jsx';

const today = new Date().toISOString().slice(0, 10);

const EMPTY_FILTERS = {
  period: 'all',
  on_date: today,
  date_from: '',
  date_to: '',
  employee_id: '',
  leave_type: '',
  status: '',
  approval_stage: '',
  live_status: '',
};

const LEAVE_COLUMNS = [
  ['employee_name', 'Employee'],
  ['employee_code', 'Employee Code'],
  ['department', 'Department'],
  ['designation', 'Designation'],
  ['leave_type_label', 'Leave Type'],
  ['day_type_label', 'Day Type'],
  ['from_date', 'From Date'],
  ['to_date', 'To Date'],
  ['leave_days', 'Leave Days'],
  ['lwp_days', 'LWP Days'],
  ['compoff_holiday_title', 'Comp-Off Holiday'],
  ['compoff_earned_date', 'Comp-Off Earned Date'],
  ['compoff_available_from', 'Comp-Off Claim From'],
  ['compoff_valid_until', 'Comp-Off Valid Until'],
  ['holiday_work_request_id', 'Holiday Work Request ID'],
  ['attendance_log_id', 'Attendance Log ID'],
  ['live_status', 'Current Status'],
  ['approval_stage_label', 'Approval Stage'],
  ['reason', 'Reason'],
  ['created_at', 'Applied On'],
];

function formatDate(value) {
  if (!value) return '—';

  try {
    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
      return value;
    }

    return parsed.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return value;
  }
}

function formatDateTime(value) {
  if (!value) return '—';

  try {
    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
      return value;
    }

    return parsed.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}

function statusLabel(value) {
  if (!value) return '—';

  return String(value)
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function leaveTypeLabel(value) {
  const normalized = String(value || '').trim().toUpperCase();

  if (normalized === 'CL' || normalized === 'CASUAL LEAVE') {
    return 'Casual Leave';
  }

  if (normalized === 'EL' || normalized === 'EARNED LEAVE') {
    return 'Earned Leave';
  }

  if (normalized === 'COMP-OFF' || normalized === 'COMPOFF') {
    return 'Comp-Off';
  }

  if (
    normalized === 'HALF-DAY' ||
    normalized === 'HALF DAY' ||
    normalized === 'HALFDAY'
  ) {
    return 'Half Day';
  }

  if (normalized === 'LWP' || normalized === 'LEAVE WITHOUT PAY') {
    return 'Leave Without Pay';
  }

  return value || 'Leave';
}

function isCompOffLeave(row = {}) {
  const leaveType = String(
    row.leave_type ||
      row.requested_leave_type ||
      row.leave_type_label ||
      row.requested_leave_type_label ||
      '',
  ).toUpperCase();

  return leaveType === 'COMP-OFF' || leaveType === 'COMPOFF';
}

function employeeOptionLabel(employee = {}) {
  const name =
    employee.name ||
    employee.employee_name ||
    employee.full_name ||
    employee.email ||
    'Employee';

  const code =
    employee.employee_code ||
    employee.emp_code ||
    employee.employee_id ||
    employee.code ||
    '';

  const designation =
    employee.designation ||
    employee.designation_name ||
    '';

  const meta = [code, designation].filter(Boolean).join(' • ');

  return meta ? `${name} (${meta})` : name;
}

function normalizeLeaveRow(row = {}) {
  const requestedLeaveType =
    row.requested_leave_type_label ||
    row.requested_leave_type ||
    row.leave_type_label ||
    row.leave_type ||
    '';

  const isHalfDay =
    Boolean(row.is_half_day) ||
    String(row.day_type || '').toLowerCase() === 'half_day' ||
    String(row.requested_leave_type || row.leave_type || '').toUpperCase() === 'HALF-DAY' ||
    Number(row.leave_days || 0) === 0.5;

  const liveStatus =
    row.live_status ||
    row.status_text ||
    row.status_display ||
    row.current_approval_stage ||
    row.approval_stage_label ||
    statusLabel(row.status);

  return {
    ...row,
    id: row.id || row._id || '',
    employee_name: row.employee_name || row.name || 'Employee',
    employee_code: row.employee_code || row.emp_code || row.employee_id || '—',
    department: row.department || row.department_name || '—',
    designation: row.designation || row.designation_name || '—',
    leave_type_label: leaveTypeLabel(requestedLeaveType),
    day_type_label: isHalfDay ? 'Half Day' : 'Full Day',
    from_date_display: formatDate(row.from_date || row.date),
    to_date_display: formatDate(row.to_date || row.upto_date || row.from_date || row.date),
    created_at_display: formatDateTime(row.created_at),
    approved_at_display: formatDateTime(row.approved_at || row.decided_at),
    live_status: liveStatus,
    approval_stage_label: row.approval_stage_label || statusLabel(row.approval_stage),
    lwp_days: Number(row.lwp_days || 0),
    leave_days: row.leave_days ?? '—',
    reason: row.reason || '—',

    is_compoff_leave: isCompOffLeave(row),
    compoff_id: row.compoff_id || row.compoff_credit_id || '',
    compoff_holiday_title: row.compoff_holiday_title || row.holiday_title || '—',
    compoff_earned_date: formatDate(row.compoff_earned_date),
    compoff_available_from: formatDate(row.compoff_available_from),
    compoff_valid_until: formatDate(row.compoff_valid_until),
    holiday_work_request_id: row.holiday_work_request_id || '—',
    attendance_log_id: row.attendance_log_id || '—',
  };
}

function normalizeLeaveRows(rows = []) {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.map((row) => normalizeLeaveRow(row));
}

function buildReportParams(filters = {}) {
  const payload = {
    employee_id: filters.employee_id,
    leave_type: filters.leave_type,
    status: filters.status,
    approval_stage: filters.approval_stage,
    live_status: filters.live_status,
  };

  if (filters.period === 'today') {
    payload.period = 'day';
    payload.on_date = today;
  } else if (filters.period === 'day') {
    payload.period = 'day';
    payload.on_date = filters.on_date || today;
  } else if (filters.period === 'week') {
    payload.period = 'week';
    payload.on_date = filters.on_date || today;
  } else if (filters.period === 'month') {
    payload.period = 'month';
    payload.on_date = filters.on_date || today;
  } else if (filters.period === 'year') {
    payload.period = 'year';
    payload.on_date = filters.on_date || today;
  } else if (filters.period === 'custom') {
    payload.date_from = filters.date_from;
    payload.date_to = filters.date_to;
  }

  return payload;
}

function leaveStatusClass(value = '') {
  const status = String(value || '').toLowerCase();

  if (status.includes('approved')) return 'leave-status approved';
  if (status.includes('rejected')) return 'leave-status rejected';
  if (status.includes('pending')) return 'leave-status pending';

  return 'leave-status neutral';
}

export default function Leave() {
  const alerts = useCustomAlert();

  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingEmployees, setLoadingEmployees] = useState(false);

  const normalizedRows = useMemo(() => normalizeLeaveRows(rows), [rows]);

  const computedSummary = useMemo(() => {
    const total = normalizedRows.length;
    const pending = normalizedRows.filter((row) =>
      String(row.live_status || row.status || '').toLowerCase().includes('pending')
    ).length;
    const approved = normalizedRows.filter((row) =>
      String(row.live_status || row.status || '').toLowerCase().includes('approved')
    ).length;
    const rejected = normalizedRows.filter((row) =>
      String(row.live_status || row.status || '').toLowerCase().includes('rejected')
    ).length;
    const halfDay = normalizedRows.filter((row) => row.day_type_label === 'Half Day').length;
    const lwp = normalizedRows.reduce((sum, row) => sum + Number(row.lwp_days || 0), 0);

    return {
      total: summary.total ?? total,
      pending: summary.pending ?? pending,
      approved: summary.approved ?? approved,
      rejected: summary.rejected ?? rejected,
      half_day: summary.half_day ?? halfDay,
      lwp: summary.lwp ?? lwp,
    };
  }, [normalizedRows, summary]);

  async function loadEmployees() {
    try {
      setLoadingEmployees(true);

      const data = await getActiveEmployees({
        limit: 1000,
        employee_scope: 'active',
      });

      setEmployees(data.items || []);
    } catch (error) {
      setEmployees([]);
      alerts.error(
        error.message || 'Unable to load employee list.',
        'Employee List Failed',
      );
    } finally {
      setLoadingEmployees(false);
    }
  }

  async function loadLeaves(nextFilters = filters, options = {}) {
    const errorTitle = options.errorTitle || 'Leave Records Load Failed';

    try {
      setLoading(true);

      const data = await getLeaveRequestReports(buildReportParams(nextFilters));

      setRows(data.items || []);
      setSummary(data.summary || {});
    } catch (error) {
      setRows([]);
      setSummary({});
      alerts.error(
        error.message || 'Unable to load leave records.',
        errorTitle,
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadEmployees();
    loadLeaves({ ...EMPTY_FILTERS });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateFilter(key, value) {
    setFilters((current) => {
      const next = {
        ...current,
        [key]: value,
      };

      if (key === 'period') {
        if (value === 'today') {
          next.on_date = today;
          next.date_from = '';
          next.date_to = '';
        }

        if (['day', 'week', 'month', 'year'].includes(value) && !next.on_date) {
          next.on_date = today;
        }

        if (value !== 'custom') {
          next.date_from = '';
          next.date_to = '';
        }
      }

      return next;
    });
  }

  async function handleSearch(event) {
    event.preventDefault();
    await loadLeaves(filters, { errorTitle: 'Search Failed' });
  }

  async function handleReset() {
    const cleared = { ...EMPTY_FILTERS };
    setFilters(cleared);
    await loadLeaves(cleared, { errorTitle: 'Reset Failed' });
  }

function handleCsvExport() {
  if (!normalizedRows.length) {
    alerts.warning('There are no leave records to export.', 'Export Not Available');
    return;
  }

  const exportRows = normalizedRows.map((row) => ({
    ...row,
    from_date: row.from_date_display,
    to_date: row.to_date_display,
    created_at: row.created_at_display,
    compoff_holiday_title: row.is_compoff_leave ? row.compoff_holiday_title : '',
    compoff_earned_date: row.is_compoff_leave ? row.compoff_earned_date : '',
    compoff_available_from: row.is_compoff_leave ? row.compoff_available_from : '',
    compoff_valid_until: row.is_compoff_leave ? row.compoff_valid_until : '',
    holiday_work_request_id: row.is_compoff_leave ? row.holiday_work_request_id : '',
    attendance_log_id: row.is_compoff_leave ? row.attendance_log_id : '',
  }));

  downloadCsv('hr-leave-management.csv', exportRows, LEAVE_COLUMNS);
  alerts.success('Leave records CSV export is ready.', 'Export Ready');
}

  return (
    <div className="page-grid leave-management-page">

      <style>{`
        .leave-management-page{
          --leave-ink:#101a3a;
          --leave-muted:#596483;
          --leave-primary:#6254da;
          --leave-deep:#342b78;
          --leave-teal:#18aaa8;
          --leave-blue:#3766db;
          --leave-ease:cubic-bezier(.22,1,.36,1);
          display:grid;
          gap:22px;
          width:100%;
          min-width:0;
          padding-bottom:max(34px,env(safe-area-inset-bottom));
          color:var(--leave-ink);
          font-family:var(--yc-ui,var(--body),inherit);
        }

        .leave-management-page .leave-hero{
          position:relative;
          isolation:isolate;
          overflow:hidden;
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:28px;
          min-height:230px;
          padding:clamp(25px,3vw,40px);
          border:1px solid rgba(171,181,211,.72);
          border-radius:clamp(28px,2.5vw,40px);
          background:
            radial-gradient(circle at 8% 8%,rgba(121,219,238,.34),transparent 31%),
            radial-gradient(circle at 92% 12%,rgba(191,190,249,.3),transparent 34%),
            linear-gradient(135deg,#f1fbff 0%,#fffdf8 48%,#f8f2ff 100%);
          box-shadow:12px 14px 0 #b9d7ff,0 28px 48px rgba(34,38,110,.13);
        }

        .leave-management-page .leave-hero::before{
          content:"";
          position:absolute;
          inset:0;
          z-index:-2;
          opacity:.42;
          background-image:
            linear-gradient(rgba(65,55,161,.035) 1px,transparent 1px),
            linear-gradient(90deg,rgba(65,55,161,.035) 1px,transparent 1px);
          background-size:42px 42px;
          pointer-events:none;
        }

        .leave-management-page .leave-hero::after{
          content:"";
          position:absolute;
          z-index:-1;
          width:clamp(165px,20vw,290px);
          aspect-ratio:1;
          right:clamp(-110px,-7vw,-55px);
          top:clamp(-118px,-8vw,-60px);
          border:1px solid rgba(65,55,161,.12);
          border-radius:34% 66% 58% 42% / 44% 38% 62% 56%;
          background:linear-gradient(145deg,rgba(105,217,208,.72),rgba(121,189,242,.72));
          transform:rotate(18deg);
        }

        .leave-management-page .leave-hero>div{min-width:0;max-width:860px}
        .leave-management-page .kicker{
          display:inline-flex;
          align-items:center;
          width:fit-content;
          padding:9px 13px;
          border-radius:999px;
          background:var(--leave-deep);
          color:#fff;
          font-size:9px;
          font-weight:950;
          line-height:1;
          letter-spacing:.12em;
          text-transform:uppercase;
        }
        .leave-management-page .leave-hero h1{
          margin:15px 0 10px;
          color:var(--leave-ink);
          font-family:var(--yc-display,var(--heading),inherit);
          font-size:clamp(34px,4.4vw,66px);
          font-weight:760;
          line-height:.94;
          letter-spacing:-.055em;
        }
        .leave-management-page .leave-hero p{
          max-width:810px;
          margin:0;
          color:var(--leave-muted);
          font-size:clamp(13px,1vw,16px);
          line-height:1.68;
        }

        .leave-management-page button{
          touch-action:manipulation;
          font-weight:900;
          transition:transform 240ms var(--leave-ease),box-shadow 240ms var(--leave-ease),filter 200ms ease;
        }
        .leave-management-page button:hover:not(:disabled){transform:translateY(-2px);filter:saturate(1.04)}
        .leave-management-page button:active:not(:disabled){transform:translateY(0) scale(.985)}
        .leave-management-page button:disabled{opacity:.56;cursor:not-allowed;transform:none;filter:none}

        .leave-management-page .primary,
        .leave-management-page .secondary{
          display:inline-flex;
          align-items:center;
          justify-content:center;
          gap:8px;
          min-height:46px;
          padding:0 17px;
          border-radius:14px;
          line-height:1;
          white-space:nowrap;
        }
        .leave-management-page .primary{
          border:1px solid rgba(52,43,120,.16);
          color:#fff;
          background:linear-gradient(145deg,#4f72df,#2bb9b5);
          box-shadow:5px 6px 0 rgba(52,43,120,.8),0 12px 22px rgba(55,102,219,.16);
        }
        .leave-management-page .secondary{
          border:1px solid rgba(98,84,218,.18);
          color:var(--leave-deep);
          background:#f1efff;
          box-shadow:4px 5px 0 rgba(98,84,218,.14);
        }

        .leave-management-page .stats-grid{
          display:grid;
          grid-template-columns:repeat(6,minmax(0,1fr));
          gap:15px;
        }
        .leave-management-page .stat-card{
          min-width:0;
          min-height:118px;
          padding:18px;
          border:1px solid rgba(171,181,211,.68);
          border-radius:21px;
          background:#f8fbff;
          box-shadow:7px 9px 0 #b9d7ff,0 18px 30px rgba(15,20,75,.08);
          transition:transform 260ms var(--leave-ease),border-color 220ms ease;
        }
        .leave-management-page .stat-card:nth-child(2){background:#fff4d5;box-shadow:7px 9px 0 #ffe0a5,0 18px 30px rgba(15,20,75,.08)}
        .leave-management-page .stat-card:nth-child(3){background:#eaf8f4;box-shadow:7px 9px 0 #aee6d9,0 18px 30px rgba(15,20,75,.08)}
        .leave-management-page .stat-card:nth-child(4){background:#ffe8ef;box-shadow:7px 9px 0 #ffc4d5,0 18px 30px rgba(15,20,75,.08)}
        .leave-management-page .stat-card:nth-child(5){background:#f1efff;box-shadow:7px 9px 0 #c9c0ff,0 18px 30px rgba(15,20,75,.08)}
        .leave-management-page .stat-card:nth-child(6){background:#edf6ff;box-shadow:7px 9px 0 #c7def8,0 18px 30px rgba(15,20,75,.08)}
        .leave-management-page .stat-card:hover{transform:translateY(-3px);border-color:rgba(98,84,218,.3)}
        .leave-management-page .stat-card span{
          display:block;
          color:var(--leave-muted);
          font-size:10px;
          font-weight:900;
          letter-spacing:.06em;
          text-transform:uppercase;
        }
        .leave-management-page .stat-card strong{
          display:block;
          margin-top:8px;
          color:var(--leave-ink);
          font-family:var(--yc-display,var(--heading),inherit);
          font-size:31px;
          line-height:1;
          letter-spacing:-.04em;
        }
        .leave-management-page .stat-card small{
          display:block;
          margin-top:7px;
          color:#7d88a4;
          font-size:11px;
          line-height:1.35;
        }

        .leave-management-page .panel{
          min-width:0;
          overflow:hidden;
          border:1px solid rgba(171,181,211,.72);
          border-radius:clamp(24px,2vw,32px);
          background:linear-gradient(145deg,rgba(255,255,255,.99),rgba(244,249,255,.98));
          box-shadow:9px 11px 0 #d1dcfa,0 24px 42px rgba(34,38,110,.1);
        }
        .leave-management-page .toolbar{
          display:flex;
          align-items:flex-end;
          justify-content:space-between;
          gap:18px;
          padding:23px 25px 18px;
          border-bottom:1px solid rgba(65,55,161,.08);
          background:rgba(255,255,255,.66);
        }
        .leave-management-page .toolbar>div{min-width:0}
        .leave-management-page .toolbar h3{
          margin:0;
          color:var(--leave-ink);
          font-family:var(--yc-display,var(--heading),inherit);
          font-size:clamp(22px,2vw,30px);
          font-weight:760;
          line-height:1;
          letter-spacing:-.03em;
        }
        .leave-management-page .toolbar p{
          margin:6px 0 0;
          color:var(--leave-muted);
          font-size:12px;
          line-height:1.5;
        }

        .leave-management-page .dynamic-form{
          display:grid;
          grid-template-columns:repeat(4,minmax(0,1fr));
          gap:14px;
          padding:20px 25px 25px;
          background:linear-gradient(145deg,rgba(237,248,255,.44),rgba(248,241,255,.34));
        }
        .leave-management-page .dynamic-form label{
          display:grid;
          min-width:0;
          gap:7px;
          color:#334164;
          font-size:12px;
          font-weight:900;
        }
        .leave-management-page .dynamic-form input,
        .leave-management-page .dynamic-form select{
          width:100%;
          min-width:0;
          min-height:46px;
          border:1px solid rgba(159,169,205,.62);
          border-radius:14px;
          outline:none;
          background:rgba(255,255,255,.9);
          color:var(--leave-ink);
          padding:0 13px;
          font:inherit;
          font-weight:600;
          transition:border-color 180ms ease,box-shadow 180ms ease,background 180ms ease;
        }
        .leave-management-page .dynamic-form input:hover,
        .leave-management-page .dynamic-form select:hover{border-color:rgba(98,84,218,.34)}
        .leave-management-page .dynamic-form input:focus,
        .leave-management-page .dynamic-form select:focus{
          border-color:var(--leave-primary);
          background:#fff;
          box-shadow:0 0 0 4px rgba(98,84,218,.11);
        }
        .leave-management-page .dynamic-form>button{align-self:end}

        .leave-management-page .inline-message{
          margin:22px 25px;
          padding:15px 16px;
          border:1px solid rgba(98,84,218,.14);
          border-radius:15px;
          background:#f1efff;
          color:var(--leave-deep);
          font-size:12px;
          font-weight:850;
        }
        .leave-management-page .empty-state{
          display:grid;
          justify-items:center;
          gap:10px;
          padding:52px 22px;
          background:linear-gradient(145deg,rgba(237,248,255,.58),rgba(248,241,255,.52));
          color:var(--leave-muted);
          text-align:center;
        }
        .leave-management-page .empty-state svg{color:var(--leave-primary)}
        .leave-management-page .empty-state h3{margin:0;color:var(--leave-ink);font-size:18px;font-weight:950}
        .leave-management-page .empty-state p{max-width:540px;margin:0;font-size:12px;line-height:1.6}

        .leave-management-page .leave-card-grid{
          display:grid;
          grid-template-columns:repeat(2,minmax(0,1fr));
          gap:16px;
          padding:20px 25px 25px;
        }
        .leave-management-page .leave-card{
          min-width:0;
          overflow:hidden;
          border:1px solid rgba(171,181,211,.68);
          border-radius:22px;
          background:linear-gradient(145deg,#fff,#f7fbff);
          box-shadow:6px 8px 0 rgba(185,215,255,.76),0 18px 28px rgba(34,38,110,.08);
          transition:transform 260ms var(--leave-ease),border-color 220ms ease;
        }
        .leave-management-page .leave-card:hover{transform:translateY(-3px);border-color:rgba(98,84,218,.3)}
        .leave-management-page .leave-card-head{
          display:flex;
          align-items:flex-start;
          justify-content:space-between;
          gap:14px;
          padding:18px;
          border-bottom:1px solid rgba(65,55,161,.09);
          background:linear-gradient(145deg,rgba(241,239,255,.65),rgba(237,248,255,.52));
        }
        .leave-management-page .leave-card-head>div{min-width:0}
        .leave-management-page .leave-card-head h3{
          margin:0;
          color:var(--leave-ink);
          font-size:17px;
          font-weight:950;
          overflow-wrap:anywhere;
        }
        .leave-management-page .leave-card-head p{
          margin:5px 0 0;
          color:var(--leave-muted);
          font-size:11px;
          line-height:1.45;
          overflow-wrap:anywhere;
        }
        .leave-management-page .leave-status{
          display:inline-flex;
          align-items:center;
          min-height:30px;
          padding:0 10px;
          border-radius:999px;
          font-size:10px;
          font-weight:900;
          white-space:nowrap;
        }
        .leave-management-page .leave-status.approved{color:#13736f;background:#dff8f3}
        .leave-management-page .leave-status.rejected{color:#b62f55;background:#ffe4ec}
        .leave-management-page .leave-status.pending{color:#996400;background:#fff0c3}
        .leave-management-page .leave-status.neutral{color:#5f6983;background:#edf0f6}

        .leave-management-page .leave-card-body{
          display:grid;
          grid-template-columns:repeat(3,minmax(0,1fr));
          gap:10px;
          padding:16px 18px;
        }
        .leave-management-page .leave-card-body>span{
          min-width:0;
          padding:11px;
          border:1px solid rgba(98,84,218,.08);
          border-radius:13px;
          background:rgba(241,239,255,.48);
        }
        .leave-management-page .leave-card-body small,
        .leave-management-page .leave-card-footer small{
          display:block;
          color:var(--leave-muted);
          font-size:9px;
          font-weight:900;
          letter-spacing:.04em;
          text-transform:uppercase;
        }
        .leave-management-page .leave-card-body strong{
          display:block;
          margin-top:5px;
          color:#334164;
          font-size:12px;
          line-height:1.4;
          overflow-wrap:anywhere;
        }
        .leave-management-page .leave-card-footer{
          display:grid;
          gap:14px;
          padding:0 18px 18px;
        }
        .leave-management-page .leave-card-footer p{
          margin:6px 0 0;
          color:#4d5b7a;
          font-size:12px;
          line-height:1.55;
          overflow-wrap:anywhere;
        }
        .leave-management-page .leave-meta-row{
          display:flex;
          flex-wrap:wrap;
          gap:8px;
        }
        .leave-management-page .leave-meta-row span{
          display:inline-flex;
          align-items:center;
          gap:6px;
          min-height:30px;
          padding:0 10px;
          border-radius:999px;
          background:#edf6ff;
          color:#46577f;
          font-size:10px;
          font-weight:850;
        }

        @media (min-width:1500px){
          .leave-management-page .leave-card-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
        }
        @media (max-width:1180px){
          .leave-management-page .stats-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
          .leave-management-page .dynamic-form{grid-template-columns:repeat(3,minmax(0,1fr))}
        }
        @media (max-width:860px){
          .leave-management-page .leave-card-grid{grid-template-columns:1fr}
          .leave-management-page .dynamic-form{grid-template-columns:repeat(2,minmax(0,1fr))}
        }
        @media (max-width:640px){
          .leave-management-page{gap:16px}
          .leave-management-page .leave-hero{
            align-items:flex-start;
            flex-direction:column;
            min-height:auto;
            padding:20px;
            border-radius:24px;
            box-shadow:7px 8px 0 #b9d7ff,0 18px 30px rgba(34,38,110,.1);
          }
          .leave-management-page .leave-hero h1{font-size:clamp(31px,9.2vw,43px)}
          .leave-management-page .leave-hero .secondary{width:100%}
          .leave-management-page .stats-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
          .leave-management-page .stat-card{min-height:112px;padding:14px;border-radius:17px}
          .leave-management-page .stat-card strong{font-size:25px}
          .leave-management-page .panel{
            border-radius:23px;
            box-shadow:6px 7px 0 #d1dcfa,0 16px 28px rgba(34,38,110,.08);
          }
          .leave-management-page .toolbar{
            align-items:flex-start;
            flex-direction:column;
            padding:20px 17px 15px;
          }
          .leave-management-page .toolbar .secondary{width:100%}
          .leave-management-page .dynamic-form{grid-template-columns:1fr;padding:16px 17px 20px}
          .leave-management-page .dynamic-form>button{width:100%}
          .leave-management-page .leave-card-grid{padding:15px 12px 19px}
          .leave-management-page .leave-card-head{flex-direction:column}
          .leave-management-page .leave-card-body{grid-template-columns:repeat(2,minmax(0,1fr))}
        }
        @media (max-width:430px){
          .leave-management-page .stats-grid{grid-template-columns:1fr}
          .leave-management-page .stat-card{min-height:auto}
          .leave-management-page .leave-card-body{grid-template-columns:1fr}
        }
        @media (prefers-reduced-motion:reduce){
          .leave-management-page *,
          .leave-management-page *::before,
          .leave-management-page *::after{
            animation-duration:.01ms!important;
            animation-iteration-count:1!important;
            transition-duration:.01ms!important;
            scroll-behavior:auto!important;
          }
        }
      `}</style>

      <section className="hero compact leave-hero">
        <div>
          <span className="kicker">HR Leave Management</span>
          <h1>Leave Records & Daily Availability</h1>
            <p>
              Review all leave records by default, track approval status, comp-off
              claims, holiday work references, and filter leave records by employee,
              leave type, date range, status, and approval stage.
            </p>
        </div>

        <button
          type="button"
          className="secondary"
          onClick={() => loadLeaves(filters, { errorTitle: 'Refresh Failed' })}
          disabled={loading}
        >
          <RefreshCcw size={16} />
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </section>

      <section className="stats-grid">
        <div className="stat-card">
          <span>Total Leaves</span>
          <strong>{computedSummary.total}</strong>
          <small>Filtered records</small>
        </div>

        <div className="stat-card">
          <span>Pending</span>
          <strong>{computedSummary.pending}</strong>
          <small>Awaiting action</small>
        </div>

        <div className="stat-card">
          <span>Approved</span>
          <strong>{computedSummary.approved}</strong>
          <small>Confirmed leaves</small>
        </div>

        <div className="stat-card">
          <span>Rejected</span>
          <strong>{computedSummary.rejected}</strong>
          <small>Rejected requests</small>
        </div>

        <div className="stat-card">
          <span>Half Day</span>
          <strong>{computedSummary.half_day}</strong>
          <small>Half-day records</small>
        </div>

        <div className="stat-card">
          <span>LWP Days</span>
          <strong>{computedSummary.lwp}</strong>
          <small>Leave without pay</small>
        </div>
      </section>

      <section className="panel leave-filter-panel">
        <div className="toolbar">
          <div>
            <h3>Leave Filters</h3>
              <p>
                All leave records are shown by default. Select a period or use
                custom dates to narrow the results.
              </p>
          </div>

          <button
            type="button"
            className="secondary"
            onClick={handleCsvExport}
            disabled={!normalizedRows.length}
          >
            <Download size={16} />
            Export CSV
          </button>
        </div>

        <form className="dynamic-form" onSubmit={handleSearch}>
          <label>
            Period
            <select
              value={filters.period}
              onChange={(e) => updateFilter('period', e.target.value)}
            >
              <option value="all">All Records</option>
              <option value="today">Today</option>
              <option value="day">Specific Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
              <option value="year">Year</option>
              <option value="custom">Custom Date Range</option>
            </select>
          </label>

          {['today', 'day', 'week', 'month', 'year'].includes(filters.period) && (
            <label>
              Reference Date
                <input
                  type="date"
                  value={filters.on_date}
                  onChange={(e) => updateFilter('on_date', e.target.value)}
                  onWheel={preventDateWheelChange}
                />
            </label>
          )}

          {filters.period === 'custom' && (
            <>
              <label>
                Date From
                <input
                  type="date"
                  value={filters.date_from}
                  onChange={(e) => updateFilter('date_from', e.target.value)}
                  onWheel={preventDateWheelChange}
                />
              </label>

              <label>
                Date To
                  <input
                    type="date"
                    value={filters.date_to}
                    onChange={(e) => updateFilter('date_to', e.target.value)}
                    onWheel={preventDateWheelChange}
                  />
              </label>
            </>
          )}

          <label>
            Employee
            <select
              value={filters.employee_id}
              onChange={(e) => updateFilter('employee_id', e.target.value)}
              disabled={loadingEmployees}
            >
              <option value="">All Employees</option>
              {employees.map((employee) => {
                const id = employee.id || employee._id || '';
                return (
                  <option
                    key={id || employee.employee_code || employee.email}
                    value={id}
                  >
                    {employeeOptionLabel(employee)}
                  </option>
                );
              })}
            </select>
          </label>

          <label>
            Leave Type
            <select
              value={filters.leave_type}
              onChange={(e) => updateFilter('leave_type', e.target.value)}
            >
              <option value="">All Leave Types</option>
              <option value="CL">Casual Leave</option>
              <option value="EL">Earned Leave</option>
              <option value="COMP-OFF">Comp-Off</option>
              <option value="HALF-DAY">Half Day</option>
              <option value="LWP">Leave Without Pay</option>
            </select>
          </label>

          <label>
            Status
            <select
              value={filters.status}
              onChange={(e) => updateFilter('status', e.target.value)}
            >
              <option value="">All Status</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>

          <label>
            Approval Stage
            <select
              value={filters.approval_stage}
              onChange={(e) => updateFilter('approval_stage', e.target.value)}
            >
              <option value="">All Stages</option>
              <option value="team_leader">Team Leader</option>
              <option value="reporting_officer">Reporting Officer</option>
              <option value="hr">HR</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>

          <label>
            Live Status
            <select
              value={filters.live_status}
              onChange={(e) => updateFilter('live_status', e.target.value)}
            >
              <option value="">All Live Status</option>
              <option value="pending_with_team_leader">Pending with Team Leader</option>
              <option value="pending_with_reporting_officer">Pending with Reporting Officer</option>
              <option value="pending_with_hr">Pending with HR</option>
            </select>
          </label>

          <button
            type="submit"
            className="primary"
            disabled={loading}
          >
            <Search size={16} />
            {loading ? 'Searching...' : 'Search Leaves'}
          </button>

          <button
            type="button"
            className="secondary"
            onClick={handleReset}
            disabled={loading}
          >
            <Filter size={16} />
            Reset Filters
          </button>
        </form>
      </section>

      <section className="panel leave-record-panel">
        <div className="toolbar">
          <div>
            <h3>Leave Records</h3>
            <p>
              {filters.period === 'all'
                ? 'Showing all leave records.'
                : filters.period === 'today'
                  ? 'Showing leave records for today.'
                  : 'Showing leave records based on selected filters.'}
            </p>
          </div>
        </div>

        {loading && <div className="inline-message">Loading leave records...</div>}

        {!loading && !normalizedRows.length && (
          <div className="empty-state">
            <CalendarDays size={34} />
            <h3>No leave records found</h3>
            <p>No employees are on leave for the selected period or filters.</p>
          </div>
        )}

        {!!normalizedRows.length && (
          <div className="leave-card-grid">
            {normalizedRows.map((row) => (
              <article key={row.id || `${row.employee_name}-${row.from_date_display}`} className="leave-card">
                <div className="leave-card-head">
                  <div>
                    <h3>{row.employee_name}</h3>
                    <p>
                      {row.employee_code} • {row.department} • {row.designation}
                    </p>
                  </div>

                  <span className={leaveStatusClass(row.live_status)}>
                    {row.live_status}
                  </span>
                </div>

                <div className="leave-card-body">
                  <span>
                    <small>Leave Type</small>
                    <strong>{row.leave_type_label}</strong>
                  </span>

                  <span>
                    <small>Day Type</small>
                    <strong>{row.day_type_label}</strong>
                  </span>

                  <span>
                    <small>From</small>
                    <strong>{row.from_date_display}</strong>
                  </span>

                  <span>
                    <small>To</small>
                    <strong>{row.to_date_display}</strong>
                  </span>

                  <span>
                    <small>Leave Days</small>
                    <strong>{row.leave_days}</strong>
                  </span>

                  <span>
                    <small>LWP Days</small>
                    <strong>{row.lwp_days || '—'}</strong>
                  </span>

                  {row.is_compoff_leave && (
                    <>
                      <span>
                        <small>Comp-Off Holiday</small>
                        <strong>{row.compoff_holiday_title}</strong>
                      </span>

                      <span>
                        <small>Claim Window</small>
                        <strong>
                          {row.compoff_available_from} to {row.compoff_valid_until}
                        </strong>
                      </span>
                    </>
                  )}

                </div>

                <div className="leave-card-footer">
                  <div>
                    <small>Reason</small>
                    <p>{row.reason}</p>

                    {row.is_compoff_leave && (
                      <p>
                        Comp-Off Credit: {row.compoff_id || '—'} <br />
                        Holiday Work Request: {row.holiday_work_request_id} <br />
                        Attendance Log: {row.attendance_log_id}
                      </p>
                    )}
                  </div>

                  <div className="leave-meta-row">
                    <span>
                      <Clock3 size={14} />
                      Applied: {row.created_at_display}
                    </span>

                    <span>
                      {String(row.live_status || '').toLowerCase().includes('approved') ? (
                        <CheckCircle2 size={14} />
                      ) : (
                        <XCircle size={14} />
                      )}
                      Stage: {row.approval_stage_label}
                    </span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}