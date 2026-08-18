import { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  Plus,
  RefreshCcw,
  Search,
  UserRound,
  UsersRound,
  WalletCards,
} from 'lucide-react';
import {
  getInitials,
  getLeaveBalances,
  getProfilePhotoUrl,
  listCollection,
  saveCombinedLeaveBalance,
} from '../api/client';
import { useCustomAlert } from '../components/CustomAlertProvider.jsx';
import { canManageLeaveBalances } from '../data/modules';

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.employees)) return value.employees;
  return [];
}

function getEmployeeId(employee = {}) {
  return String(
    employee._id ||
      employee.id ||
      employee.employee_ref_id ||
      employee.user_id ||
      '',
  ).trim();
}

function getEmployeeName(employee = {}) {
  return (
    employee.name ||
    employee.employee_name ||
    employee.full_name ||
    employee.display_name ||
    employee.email ||
    'Employee'
  );
}

function getEmployeeCode(employee = {}) {
  return (
    employee.employee_id ||
    employee.emp_code ||
    employee.employee_code ||
    employee.code ||
    ''
  );
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatLeaveDays(value) {
  const number = Math.max(toNumber(value, 0), 0);

  return Number.isInteger(number)
    ? String(number)
    : number.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function normalizeLeaveType(value) {
  const normalized = String(value || '').trim().toUpperCase();

  if (normalized === 'CL' || normalized.includes('CASUAL')) return 'CL';
  if (normalized === 'EL' || normalized.includes('EARNED')) return 'EL';
  return '';
}

function emptyTypeBalance() {
  return {
    opening_balance: 0,
    credited: 0,
    used: 0,
    available: 0,
    status: 'active',
  };
}

function normalizeTypeBalance(row = {}) {
  const openingBalance = Math.max(toNumber(row.opening_balance, 0), 0);
  const credited = Math.max(toNumber(row.credited, 0), 0);
  const used = Math.max(toNumber(row.used, 0), 0);
  const calculatedAvailable = Math.max(openingBalance + credited - used, 0);

  return {
    opening_balance: openingBalance,
    credited,
    used,
    available:
      row.available === undefined || row.available === null || row.available === ''
        ? calculatedAvailable
        : Math.max(toNumber(row.available, calculatedAvailable), 0),
    status: row.status || 'active',
  };
}

function isActiveEmployee(employee = {}) {
  const status = String(employee.status || employee.employee_status || 'active')
    .trim()
    .toLowerCase();

  return ![
    'inactive',
    'resigned',
    'terminated',
    'deleted',
    'alumni',
  ].includes(status);
}

function buildBalanceRows(employees = [], balanceItems = []) {
  const rows = new Map();

  employees.forEach((employee) => {
    const employeeId = getEmployeeId(employee);

    if (!employeeId) return;

    rows.set(employeeId, {
      employee_id: employeeId,
      employee,
      employee_name: getEmployeeName(employee),
      employee_code: getEmployeeCode(employee),
      department: employee.department || '',
      designation: employee.designation || '',
      cl: emptyTypeBalance(),
      el: emptyTypeBalance(),
    });
  });

  balanceItems.forEach((item) => {
    const employeeId = String(
      item.employee_id || item.employee || item.user_id || '',
    ).trim();

    if (!employeeId) return;

    if (!rows.has(employeeId)) {
      rows.set(employeeId, {
        employee_id: employeeId,
        employee: item,
        employee_name: getEmployeeName(item),
        employee_code: getEmployeeCode(item),
        department: item.department || '',
        designation: item.designation || '',
        cl: emptyTypeBalance(),
        el: emptyTypeBalance(),
      });
    }

    const row = rows.get(employeeId);
    const leaveType = normalizeLeaveType(
      item.leave_type || item.leave_type_label,
    );

    row.employee_name = item.employee_name || row.employee_name;
    row.employee_code = getEmployeeCode(item) || row.employee_code;
    row.department = item.department || row.department;
    row.designation = item.designation || row.designation;

    if (leaveType === 'CL') {
      row.cl = normalizeTypeBalance(item);
    }

    if (leaveType === 'EL') {
      row.el = normalizeTypeBalance(item);
    }
  });

  return Array.from(rows.values()).sort((left, right) =>
    left.employee_name.localeCompare(right.employee_name),
  );
}

function employeeSearchText(employee = {}) {
  return [
    getEmployeeName(employee),
    getEmployeeCode(employee),
    employee.email,
    employee.official_email,
    employee.department,
    employee.designation,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function EmployeeAvatar({ employee = {}, size = 'md' }) {
  const [imageFailed, setImageFailed] = useState(false);
  const name = getEmployeeName(employee);
  const photoUrl = imageFailed ? '' : getProfilePhotoUrl(employee);

  useEffect(() => {
    setImageFailed(false);
  }, [employee]);

  return (
    <span className={`lb-avatar lb-avatar-${size}`}>
      {photoUrl ? (
        <img
          src={photoUrl}
          alt={name}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <strong>{getInitials(name)}</strong>
      )}
    </span>
  );
}

export default function LeaveBalances({ user = {} }) {
  const alerts = useCustomAlert();
  const canManage = canManageLeaveBalances(user);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [balanceItems, setBalanceItems] = useState([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [employeeQuery, setEmployeeQuery] = useState('');
  const [tableQuery, setTableQuery] = useState('');
  const [casualLeaveToAdd, setCasualLeaveToAdd] = useState('');
  const [earnedLeaveToAdd, setEarnedLeaveToAdd] = useState('');

  const balanceRows = useMemo(
    () => buildBalanceRows(employees, balanceItems),
    [employees, balanceItems],
  );

  const selectedEmployee = useMemo(
    () =>
      employees.find(
        (employee) => getEmployeeId(employee) === selectedEmployeeId,
      ) || null,
    [employees, selectedEmployeeId],
  );

  const selectedBalance = useMemo(
    () =>
      balanceRows.find((row) => row.employee_id === selectedEmployeeId) || {
        employee_id: selectedEmployeeId,
        employee: selectedEmployee || {},
        employee_name: getEmployeeName(selectedEmployee || {}),
        employee_code: getEmployeeCode(selectedEmployee || {}),
        department: selectedEmployee?.department || '',
        designation: selectedEmployee?.designation || '',
        cl: emptyTypeBalance(),
        el: emptyTypeBalance(),
      },
    [balanceRows, selectedEmployee, selectedEmployeeId],
  );

  const employeeOptions = useMemo(() => {
    const query = employeeQuery.trim().toLowerCase();

    if (!query) return employees;

    return employees.filter(
      (employee) =>
        employeeSearchText(employee).includes(query) ||
        getEmployeeId(employee) === selectedEmployeeId,
    );
  }, [employeeQuery, employees, selectedEmployeeId]);

  const visibleRows = useMemo(() => {
    const query = tableQuery.trim().toLowerCase();

    if (!query) return balanceRows;

    return balanceRows.filter((row) =>
      [
        row.employee_name,
        row.employee_code,
        row.department,
        row.designation,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  }, [balanceRows, tableQuery]);

  const totals = useMemo(
    () =>
      balanceRows.reduce(
        (summary, row) => ({
          employees: summary.employees + 1,
          casual: summary.casual + row.cl.available,
          earned: summary.earned + row.el.available,
        }),
        { employees: 0, casual: 0, earned: 0 },
      ),
    [balanceRows],
  );

  const casualAddition = Math.max(toNumber(casualLeaveToAdd, 0), 0);
  const earnedAddition = Math.max(toNumber(earnedLeaveToAdd, 0), 0);

  async function loadData({ showLoader = true } = {}) {
    if (!canManage) {
      setLoading(false);
      return;
    }

    if (showLoader) setLoading(true);

    try {
      const [employeeResponse, balanceResponse] = await Promise.all([
        listCollection('employees', {
          limit: 1000,
          sort_by: 'name',
          sort_dir: 'asc',
        }),
        getLeaveBalances({ limit: 1000 }),
      ]);

      setEmployees(toArray(employeeResponse).filter(isActiveEmployee));
      setBalanceItems(toArray(balanceResponse));
    } catch (error) {
      alerts.error(
        error.message || 'Unable to load employee leave balances.',
        'Leave Balances Load Failed',
      );
    } finally {
      if (showLoader) setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage]);

  function selectEmployee(employeeId) {
    setSelectedEmployeeId(String(employeeId || ''));
    setCasualLeaveToAdd('');
    setEarnedLeaveToAdd('');
  }

  async function addLeave(event) {
    event.preventDefault();

    if (!selectedEmployeeId) {
      alerts.warning('Please select an employee.', 'Employee Required');
      return;
    }

    const rawCasualLeave = Number(casualLeaveToAdd || 0);
    const rawEarnedLeave = Number(earnedLeaveToAdd || 0);

    if (
      !Number.isFinite(rawCasualLeave) ||
      !Number.isFinite(rawEarnedLeave) ||
      rawCasualLeave < 0 ||
      rawEarnedLeave < 0
    ) {
      alerts.warning(
        'Leave to add must be zero or a positive number.',
        'Invalid Leave Value',
      );
      return;
    }

    if (rawCasualLeave === 0 && rawEarnedLeave === 0) {
      alerts.warning(
        'Enter Casual Leave or Earned Leave to add.',
        'Leave Value Required',
      );
      return;
    }

    setSaving(true);

    try {
      const payload = {
        employee_id: selectedEmployeeId,
        status: 'active',
      };

      if (rawCasualLeave > 0) {
        payload.casual_leave = {
          opening_balance: selectedBalance.cl.opening_balance,
          credited: selectedBalance.cl.credited + rawCasualLeave,
          used: selectedBalance.cl.used,
          status: selectedBalance.cl.status || 'active',
        };
      }

      if (rawEarnedLeave > 0) {
        payload.earned_leave = {
          opening_balance: selectedBalance.el.opening_balance,
          credited: selectedBalance.el.credited + rawEarnedLeave,
          used: selectedBalance.el.used,
          status: selectedBalance.el.status || 'active',
        };
      }

      await saveCombinedLeaveBalance(selectedEmployeeId, payload);
      await loadData({ showLoader: false });

      setCasualLeaveToAdd('');
      setEarnedLeaveToAdd('');

      const additions = [];

      if (rawCasualLeave > 0) {
        additions.push(`${formatLeaveDays(rawCasualLeave)} Casual Leave`);
      }

      if (rawEarnedLeave > 0) {
        additions.push(`${formatLeaveDays(rawEarnedLeave)} Earned Leave`);
      }

      alerts.success(
        `${additions.join(' and ')} added to ${getEmployeeName(selectedEmployee)}.`,
        'Leave Added Successfully',
      );
    } catch (error) {
      alerts.error(
        error.message || 'Unable to add leave for this employee.',
        'Add Leave Failed',
      );
    } finally {
      setSaving(false);
    }
  }

  if (!canManage) {
    return (
      <div className="leave-balances-page">
        <section className="lb-restricted">
          <CalendarDays size={34} />
          <h1>Leave Balances</h1>
          <p>
            This page can only be accessed by HR, Admin, and Super Admin.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="leave-balances-page">
      <style>{`
        .leave-balances-page {
          --lb-ink: #14213d;
          --lb-copy: #64748b;
          --lb-line: rgba(100, 116, 139, .20);
          --lb-purple: #6255d9;
          --lb-purple-dark: #3f348e;
          --lb-teal: #18a7a0;
          display: grid;
          gap: 22px;
          color: var(--lb-ink);
        }

        .lb-hero {
          position: relative;
          overflow: hidden;
          display: grid;
          grid-template-columns: minmax(0, 1.5fr) minmax(260px, .7fr);
          gap: 24px;
          align-items: end;
          padding: clamp(26px, 4vw, 46px);
          border: 1px solid rgba(135, 146, 196, .34);
          border-radius: 34px;
          background:
            radial-gradient(circle at 90% 10%, rgba(106, 213, 196, .28), transparent 30%),
            radial-gradient(circle at 8% 4%, rgba(133, 119, 234, .24), transparent 32%),
            linear-gradient(135deg, #f3f1ff, #f4fbff 52%, #effbf7);
          box-shadow: 10px 12px 0 #d4ddf7, 0 24px 46px rgba(41, 52, 109, .10);
        }

        .lb-kicker {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          width: max-content;
          margin-bottom: 14px;
          padding: 8px 12px;
          border-radius: 999px;
          color: #fff;
          background: var(--lb-purple-dark);
          font-size: 10px;
          font-weight: 900;
          letter-spacing: .10em;
          text-transform: uppercase;
        }

        .lb-hero h1 {
          margin: 0;
          font-family: Georgia, 'Times New Roman', serif;
          font-size: clamp(40px, 5vw, 70px);
          line-height: .96;
          letter-spacing: -.05em;
        }

        .lb-hero h1 em {
          color: var(--lb-purple);
          font-weight: 500;
        }

        .lb-hero p {
          max-width: 760px;
          margin: 16px 0 0;
          color: var(--lb-copy);
          line-height: 1.7;
        }

        .lb-hero-note {
          padding: 18px;
          border: 1px solid rgba(98, 85, 217, .20);
          border-radius: 22px;
          background: rgba(255, 255, 255, .74);
          box-shadow: 6px 7px 0 rgba(98, 85, 217, .16);
        }

        .lb-hero-note strong,
        .lb-hero-note span {
          display: block;
        }

        .lb-hero-note span {
          margin-top: 6px;
          color: var(--lb-copy);
          font-size: 13px;
          line-height: 1.5;
        }

        .lb-summary-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 16px;
        }

        .lb-summary-card,
        .lb-card,
        .lb-table-card {
          border: 1px solid var(--lb-line);
          border-radius: 26px;
          background: linear-gradient(145deg, #fff, #f8fbff);
          box-shadow: 7px 8px 0 #d8def7, 0 20px 34px rgba(38, 48, 94, .08);
        }

        .lb-summary-card {
          display: flex;
          align-items: center;
          gap: 14px;
          min-width: 0;
          padding: 20px;
        }

        .lb-summary-icon {
          display: grid;
          place-items: center;
          width: 48px;
          height: 48px;
          flex: 0 0 auto;
          border-radius: 16px;
          color: var(--lb-purple);
          background: #eeecff;
        }

        .lb-summary-card:nth-child(2) .lb-summary-icon {
          color: #127a76;
          background: #e4faf6;
        }

        .lb-summary-card:nth-child(3) .lb-summary-icon {
          color: #a05e09;
          background: #fff4d8;
        }

        .lb-summary-card span,
        .lb-summary-card strong {
          display: block;
        }

        .lb-summary-card span {
          color: var(--lb-copy);
          font-size: 12px;
          font-weight: 800;
        }

        .lb-summary-card strong {
          margin-top: 3px;
          font-size: clamp(23px, 3vw, 32px);
          line-height: 1;
        }

        .lb-workspace {
          display: grid;
          grid-template-columns: minmax(0, 1.18fr) minmax(300px, .82fr);
          gap: 18px;
          align-items: stretch;
        }

        .lb-card {
          padding: clamp(20px, 3vw, 30px);
        }

        .lb-card-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          margin-bottom: 22px;
        }

        .lb-card-head h2,
        .lb-table-head h2 {
          margin: 0;
          font-size: clamp(22px, 2.4vw, 30px);
        }

        .lb-card-head p,
        .lb-table-head p {
          margin: 7px 0 0;
          color: var(--lb-copy);
          font-size: 13px;
          line-height: 1.5;
        }

        .lb-form {
          display: grid;
          gap: 17px;
        }

        .lb-field {
          display: grid;
          gap: 7px;
        }

        .lb-field label {
          color: #334155;
          font-size: 12px;
          font-weight: 900;
        }

        .lb-field input,
        .lb-field select {
          width: 100%;
          min-height: 48px;
          box-sizing: border-box;
          border: 1px solid #d7dce9;
          border-radius: 15px;
          outline: none;
          color: var(--lb-ink);
          background: #fff;
          padding: 11px 13px;
          font: inherit;
          transition: border-color .18s ease, box-shadow .18s ease;
        }

        .lb-field input:focus,
        .lb-field select:focus {
          border-color: rgba(98, 85, 217, .62);
          box-shadow: 0 0 0 4px rgba(98, 85, 217, .10);
        }

        .lb-field small {
          color: var(--lb-copy);
          line-height: 1.4;
        }

        .lb-input-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }

        .lb-leave-input {
          padding: 15px;
          border: 1px solid #e0e4ef;
          border-radius: 18px;
          background: #fafbff;
        }

        .lb-leave-input strong {
          display: block;
          margin-bottom: 8px;
        }

        .lb-preview-line {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-top: 9px;
          color: var(--lb-copy);
          font-size: 12px;
        }

        .lb-preview-line b {
          color: var(--lb-purple-dark);
        }

        .lb-primary-btn,
        .lb-soft-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          width: max-content;
          border: 0;
          border-radius: 999px;
          cursor: pointer;
          font: inherit;
          font-weight: 900;
          transition: transform .16s ease, box-shadow .16s ease, opacity .16s ease;
        }

        .lb-primary-btn {
          min-width: 160px;
          padding: 13px 19px;
          color: #fff;
          background: linear-gradient(135deg, var(--lb-purple-dark), var(--lb-purple));
          box-shadow: 0 12px 22px rgba(77, 66, 174, .24);
        }

        .lb-soft-btn {
          padding: 9px 13px;
          color: var(--lb-purple-dark);
          background: #eeecff;
        }

        .lb-primary-btn:hover:not(:disabled),
        .lb-soft-btn:hover:not(:disabled) {
          transform: translateY(-2px);
        }

        .lb-primary-btn:disabled,
        .lb-soft-btn:disabled {
          cursor: not-allowed;
          opacity: .55;
        }

        .lb-selected-empty {
          min-height: 290px;
          display: grid;
          place-items: center;
          align-content: center;
          gap: 8px;
          color: var(--lb-copy);
          text-align: center;
        }

        .lb-selected-empty svg {
          color: #9b93e8;
        }

        .lb-person-head {
          display: flex;
          align-items: center;
          gap: 13px;
          margin-bottom: 18px;
        }

        .lb-person-head strong,
        .lb-person-head span {
          display: block;
        }

        .lb-person-head span {
          margin-top: 3px;
          color: var(--lb-copy);
          font-size: 12px;
        }

        .lb-avatar {
          overflow: hidden;
          display: inline-grid;
          place-items: center;
          flex: 0 0 auto;
          border-radius: 999px;
          color: var(--lb-purple-dark);
          background: linear-gradient(135deg, #e9e6ff, #e6faf6);
          border: 3px solid #fff;
          box-shadow: 0 8px 20px rgba(50, 57, 102, .14);
        }

        .lb-avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .lb-avatar-sm {
          width: 40px;
          height: 40px;
          font-size: 11px;
        }

        .lb-avatar-md {
          width: 56px;
          height: 56px;
          font-size: 15px;
        }

        .lb-balance-pair {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }

        .lb-balance-box {
          padding: 16px;
          border: 1px solid #e0e4ef;
          border-radius: 19px;
          background: #fafbff;
        }

        .lb-balance-box > span,
        .lb-balance-box > strong {
          display: block;
        }

        .lb-balance-box > span {
          color: var(--lb-copy);
          font-size: 11px;
          font-weight: 900;
          text-transform: uppercase;
        }

        .lb-balance-box > strong {
          margin: 5px 0 12px;
          color: var(--lb-purple-dark);
          font-size: 30px;
        }

        .lb-balance-meta {
          display: grid;
          gap: 5px;
          color: var(--lb-copy);
          font-size: 11px;
        }

        .lb-balance-meta div {
          display: flex;
          justify-content: space-between;
          gap: 8px;
        }

        .lb-table-card {
          overflow: hidden;
        }

        .lb-table-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 22px 24px;
          border-bottom: 1px solid var(--lb-line);
        }

        .lb-table-tools {
          display: flex;
          align-items: center;
          gap: 9px;
          flex-wrap: wrap;
        }

        .lb-search-box {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: min(280px, 100%);
          padding: 9px 12px;
          border: 1px solid #dce1ec;
          border-radius: 999px;
          background: #fff;
        }

        .lb-search-box input {
          width: 100%;
          border: 0;
          outline: none;
          background: transparent;
          font: inherit;
        }

        .lb-table-wrap {
          overflow-x: auto;
        }

        .lb-table {
          width: 100%;
          min-width: 850px;
          border-collapse: collapse;
        }

        .lb-table th,
        .lb-table td {
          padding: 14px 16px;
          border-bottom: 1px solid #edf0f5;
          text-align: left;
          vertical-align: middle;
        }

        .lb-table th {
          color: #526079;
          background: #f8faff;
          font-size: 10px;
          font-weight: 950;
          letter-spacing: .07em;
          text-transform: uppercase;
        }

        .lb-table td {
          color: #334155;
          font-size: 13px;
        }

        .lb-name-cell {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 210px;
        }

        .lb-name-cell strong {
          display: block;
        }

        .lb-number-pill {
          display: inline-flex;
          min-width: 42px;
          justify-content: center;
          padding: 6px 9px;
          border-radius: 999px;
          color: #3f348e;
          background: #eeecff;
          font-weight: 900;
        }

        .lb-number-pill.is-earned {
          color: #0f766e;
          background: #e5faf6;
        }

        .lb-empty {
          padding: 38px 20px;
          color: var(--lb-copy);
          text-align: center;
        }

        .lb-restricted {
          min-height: 360px;
          display: grid;
          place-items: center;
          align-content: center;
          gap: 10px;
          padding: 30px;
          border: 1px solid var(--lb-line);
          border-radius: 28px;
          background: #fff;
          color: var(--lb-copy);
          text-align: center;
        }

        .lb-restricted h1,
        .lb-restricted p {
          margin: 0;
        }

        @media (max-width: 980px) {
          .lb-hero,
          .lb-workspace {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 720px) {
          .lb-summary-grid,
          .lb-input-grid,
          .lb-balance-pair {
            grid-template-columns: 1fr;
          }

          .lb-hero {
            border-radius: 27px;
          }

          .lb-table-head {
            align-items: stretch;
            flex-direction: column;
          }

          .lb-table-tools,
          .lb-search-box,
          .lb-primary-btn {
            width: 100%;
          }
        }
      `}</style>

      <section className="lb-hero">
        <div>
          <span className="lb-kicker">
            <CalendarDays size={14} /> Leave Administration
          </span>
          <h1>
            Leave <em>Balances</em>
          </h1>
          <p>
            Select an employee, enter Casual Leave and Earned Leave to add,
            and save both together with one click.
          </p>
        </div>

        <div className="lb-hero-note">
          <strong>Safe balance addition</strong>
          <span>
            New leave is added to the employee&apos;s existing credit. Used leave
            and previous balance history are not reset.
          </span>
        </div>
      </section>

      <section className="lb-summary-grid" aria-label="Leave balance summary">
        <article className="lb-summary-card">
          <span className="lb-summary-icon"><UsersRound size={22} /></span>
          <div>
            <span>Active Employees</span>
            <strong>{totals.employees}</strong>
          </div>
        </article>

        <article className="lb-summary-card">
          <span className="lb-summary-icon"><WalletCards size={22} /></span>
          <div>
            <span>Total CL Available</span>
            <strong>{formatLeaveDays(totals.casual)}</strong>
          </div>
        </article>

        <article className="lb-summary-card">
          <span className="lb-summary-icon"><CheckCircle2 size={22} /></span>
          <div>
            <span>Total EL Available</span>
            <strong>{formatLeaveDays(totals.earned)}</strong>
          </div>
        </article>
      </section>

      <section className="lb-workspace">
        <article className="lb-card">
          <div className="lb-card-head">
            <div>
              <h2>Add Leave</h2>
              <p>Choose the employee and enter only the leave you want to add.</p>
            </div>
            <Plus size={24} />
          </div>

          <form className="lb-form" onSubmit={addLeave}>
            <div className="lb-field">
              <label htmlFor="leave-employee-search">Search Employee</label>
              <input
                id="leave-employee-search"
                value={employeeQuery}
                onChange={(event) => setEmployeeQuery(event.target.value)}
                placeholder="Search by name, employee ID, department or designation"
              />
            </div>

            <div className="lb-field">
              <label htmlFor="leave-employee-select">Select Employee</label>
              <select
                id="leave-employee-select"
                value={selectedEmployeeId}
                onChange={(event) => selectEmployee(event.target.value)}
                disabled={loading || saving}
              >
                <option value="">Select employee</option>
                {employeeOptions.map((employee) => (
                  <option
                    key={getEmployeeId(employee)}
                    value={getEmployeeId(employee)}
                  >
                    {getEmployeeName(employee)}
                    {getEmployeeCode(employee)
                      ? ` — ${getEmployeeCode(employee)}`
                      : ''}
                    {employee.department ? ` — ${employee.department}` : ''}
                  </option>
                ))}
              </select>
              <small>{employeeOptions.length} matching active employee(s)</small>
            </div>

            <div className="lb-input-grid">
              <div className="lb-leave-input">
                <strong>Casual Leave to Add</strong>
                <div className="lb-field">
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={casualLeaveToAdd}
                    onChange={(event) => setCasualLeaveToAdd(event.target.value)}
                    placeholder="Example: 8"
                    disabled={!selectedEmployeeId || saving}
                  />
                </div>
                <div className="lb-preview-line">
                  <span>After addition</span>
                  <b>
                    {formatLeaveDays(
                      selectedBalance.cl.available + casualAddition,
                    )} days
                  </b>
                </div>
              </div>

              <div className="lb-leave-input">
                <strong>Earned Leave to Add</strong>
                <div className="lb-field">
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={earnedLeaveToAdd}
                    onChange={(event) => setEarnedLeaveToAdd(event.target.value)}
                    placeholder="Example: 15"
                    disabled={!selectedEmployeeId || saving}
                  />
                </div>
                <div className="lb-preview-line">
                  <span>After addition</span>
                  <b>
                    {formatLeaveDays(
                      selectedBalance.el.available + earnedAddition,
                    )} days
                  </b>
                </div>
              </div>
            </div>

            <button
              type="submit"
              className="lb-primary-btn"
              disabled={saving || loading || !selectedEmployeeId}
            >
              <Plus size={17} /> {saving ? 'Adding Leave...' : 'Add Leave'}
            </button>
          </form>
        </article>

        <article className="lb-card">
          {!selectedEmployeeId ? (
            <div className="lb-selected-empty">
              <UserRound size={42} />
              <strong>No employee selected</strong>
              <span>Select an employee to see the current leave balance.</span>
            </div>
          ) : (
            <>
              <div className="lb-person-head">
                <EmployeeAvatar employee={selectedEmployee || selectedBalance.employee} />
                <div>
                  <strong>{selectedBalance.employee_name}</strong>
                  <span>
                    {selectedBalance.employee_code || 'No employee ID'}
                    {selectedBalance.department
                      ? ` • ${selectedBalance.department}`
                      : ''}
                    {selectedBalance.designation
                      ? ` • ${selectedBalance.designation}`
                      : ''}
                  </span>
                </div>
              </div>

              <div className="lb-balance-pair">
                <div className="lb-balance-box">
                  <span>Casual Leave Available</span>
                  <strong>{formatLeaveDays(selectedBalance.cl.available)}</strong>
                  <div className="lb-balance-meta">
                    <div><span>Opening</span><b>{formatLeaveDays(selectedBalance.cl.opening_balance)}</b></div>
                    <div><span>Credited</span><b>{formatLeaveDays(selectedBalance.cl.credited)}</b></div>
                    <div><span>Used</span><b>{formatLeaveDays(selectedBalance.cl.used)}</b></div>
                  </div>
                </div>

                <div className="lb-balance-box">
                  <span>Earned Leave Available</span>
                  <strong>{formatLeaveDays(selectedBalance.el.available)}</strong>
                  <div className="lb-balance-meta">
                    <div><span>Opening</span><b>{formatLeaveDays(selectedBalance.el.opening_balance)}</b></div>
                    <div><span>Credited</span><b>{formatLeaveDays(selectedBalance.el.credited)}</b></div>
                    <div><span>Used</span><b>{formatLeaveDays(selectedBalance.el.used)}</b></div>
                  </div>
                </div>
              </div>
            </>
          )}
        </article>
      </section>

      <section className="lb-table-card">
        <div className="lb-table-head">
          <div>
            <h2>Employee Leave Balances</h2>
            <p>View the latest Casual Leave and Earned Leave for every active employee.</p>
          </div>

          <div className="lb-table-tools">
            <label className="lb-search-box">
              <Search size={16} />
              <input
                value={tableQuery}
                onChange={(event) => setTableQuery(event.target.value)}
                placeholder="Search balances..."
              />
            </label>

            <button
              type="button"
              className="lb-soft-btn"
              onClick={() => loadData()}
              disabled={loading || saving}
            >
              <RefreshCcw size={15} /> {loading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
        </div>

        <div className="lb-table-wrap">
          <table className="lb-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Department</th>
                <th>CL Available</th>
                <th>CL Used</th>
                <th>EL Available</th>
                <th>EL Used</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.employee_id}>
                  <td>
                    <div className="lb-name-cell">
                      <EmployeeAvatar employee={row.employee} size="sm" />
                      <div>
                        <strong>{row.employee_name}</strong>
                      </div>
                    </div>
                  </td>
                  <td>{row.department || '—'}</td>
                  <td><span className="lb-number-pill">{formatLeaveDays(row.cl.available)}</span></td>
                  <td>{formatLeaveDays(row.cl.used)}</td>
                  <td><span className="lb-number-pill is-earned">{formatLeaveDays(row.el.available)}</span></td>
                  <td>{formatLeaveDays(row.el.used)}</td>
                  <td>
                    <button
                      type="button"
                      className="lb-soft-btn"
                      onClick={() => {
                        selectEmployee(row.employee_id);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      disabled={saving}
                    >
                      Add Leave
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!visibleRows.length && (
          <div className="lb-empty">
            {loading ? 'Loading leave balances...' : 'No employee leave balances found.'}
          </div>
        )}
      </section>
    </div>
  );
}