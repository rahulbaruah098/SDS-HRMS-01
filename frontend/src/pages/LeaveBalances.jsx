import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  Download,
  Filter,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  RefreshCcw,
  Search,
  Sparkles,
  UserRound,
  X,
  XCircle,
} from 'lucide-react';
import {
  getInitials,
  correctLeaveAvailableBalance,
  getLeaveBalances,
  exportLeaveBalancesWorkbook,
  getProfilePhotoUrl,
  listCollection,
  saveCombinedLeaveBalance,
} from '../api/client';
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
      employee.employee_id ||
      employee.emp_code ||
      employee.employee_code ||
      '',
  ).trim();
}

function normalizeEmployeeIdentifier(value) {
  return String(value || '').trim().toLowerCase();
}

function getEmployeeIdentifiers(employee = {}) {
  return [
    employee._id,
    employee.id,
    employee.employee_ref_id,
    employee.employee,
    employee.employee_id,
    employee.emp_code,
    employee.employee_code,
    employee.code,
    employee.user_id,
    employee.email,
    employee.official_email,
    employee.work_email,
  ]
    .map(normalizeEmployeeIdentifier)
    .filter(Boolean);
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
  const inactiveStatuses = new Set([
    'inactive',
    'disabled',
    'resigned',
    'resign',
    'left',
    'terminated',
    'retired',
    'deleted',
    'alumni',
    'ex-employee',
    'ex_employee',
  ]);
  const statuses = [
    employee.status,
    employee.employment_status,
    employee.employee_status,
  ]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
  const alumniFlag = String(employee.is_alumni || '').trim().toLowerCase();
  const activeFlag = String(employee.is_active ?? '').trim().toLowerCase();
  const deletedFlag = String(employee.is_deleted || '').trim().toLowerCase();

  if (employee.is_alumni === true || ['true', '1', 'yes'].includes(alumniFlag)) {
    return false;
  }

  if (employee.is_active === false || ['false', '0', 'no'].includes(activeFlag)) {
    return false;
  }

  if (employee.is_deleted === true || ['true', '1', 'yes'].includes(deletedFlag)) {
    return false;
  }

  return !statuses.some((status) => inactiveStatuses.has(status));
}

function buildBalanceRows(employees = [], balanceItems = []) {
  const rows = new Map();
  const employeeAliasToRowId = new Map();

  employees.filter(isActiveEmployee).forEach((employee) => {
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

    getEmployeeIdentifiers(employee).forEach((identifier) => {
      if (!employeeAliasToRowId.has(identifier)) {
        employeeAliasToRowId.set(identifier, employeeId);
      }
    });
  });

  balanceItems.forEach((item) => {
    const activeEmployeeId = getEmployeeIdentifiers(item)
      .map((identifier) => employeeAliasToRowId.get(identifier))
      .find(Boolean);

    // Leave balances are historical records and remain in the database after
    // resignation. This active management page must never recreate a row for
    // a resigned/alumni employee from an unmatched historical balance record.
    if (!activeEmployeeId || !rows.has(activeEmployeeId)) return;

    const row = rows.get(activeEmployeeId);
    const leaveType = normalizeLeaveType(
      item.leave_type || item.leave_type_label,
    );

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


const LEAVE_BALANCE_NOTICE_HIDE_MS = 3600;
const LEAVE_BALANCE_PAGE_SIZES = [10, 25, 50, 100];

function leaveBalancePageNumbers(pageCount, page) {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const current = Math.max(1, Math.min(pageCount, page));
  const pages = new Set([1, pageCount, current]);

  if (current > 2) pages.add(current - 1);
  if (current < pageCount - 1) pages.add(current + 1);

  const sorted = Array.from(pages).sort((a, b) => a - b);
  const output = [];

  sorted.forEach((value, index) => {
    const previous = sorted[index - 1];

    if (index > 0 && value - previous > 1) {
      output.push(`ellipsis-${previous}-${value}`);
    }

    output.push(value);
  });

  return output;
}

function LeaveBalanceInlineMessage({ message, onClose }) {
  if (!message?.text) return null;

  return (
    <div
      className={`lb-inline-feedback ${message.type || 'info'}`}
      role="status"
    >
      <span className="lb-inline-feedback-icon">
        {message.loading ? (
          <Loader2 size={15} className="lb-spin" />
        ) : message.type === 'success' ? (
          <CheckCircle2 size={15} />
        ) : message.type === 'error' || message.type === 'warning' ? (
          <XCircle size={15} />
        ) : (
          <Sparkles size={15} />
        )}
      </span>

      <span className="lb-inline-feedback-copy">
        {message.title ? <strong>{message.title}</strong> : null}
        <span>{message.text}</span>
      </span>

      <button
        type="button"
        className="lb-inline-feedback-close"
        onClick={onClose}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
}

function LeaveBalancePageSize({
  total,
  pageSize,
  onPageSizeChange,
}) {
  if (!total) return null;

  return (
    <div className="lb-pagination-view">
      <div className="lb-pagination-copy">
        <strong>{Number(total || 0).toLocaleString('en-IN')}</strong>
        <span>employees</span>
      </div>

      <label className="lb-page-size">
        <span>View</span>
        <select
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
          aria-label="Employees per page"
        >
          {LEAVE_BALANCE_PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function LeaveBalancePagination({
  total,
  page,
  pageSize,
  onPageChange,
}) {
  const pageCount = Math.max(
    1,
    Math.ceil(Number(total || 0) / Math.max(1, Number(pageSize || 10))),
  );
  const safePage = Math.min(Math.max(1, page), pageCount);

  if (!total) return null;

  return (
    <div className="lb-pagination">
      <div className="lb-pagination-controls">
        <button
          type="button"
          className="lb-page-button lb-page-nav"
          onClick={() => onPageChange(Math.max(1, safePage - 1))}
          disabled={safePage <= 1}
        >
          <ChevronLeft size={15} />
          <span>Previous</span>
        </button>

        <div className="lb-page-numbers" aria-label="Pagination">
          {leaveBalancePageNumbers(pageCount, safePage).map((item) =>
            typeof item === 'number' ? (
              <button
                type="button"
                key={item}
                className={`lb-page-number ${
                  item === safePage ? 'is-active' : ''
                }`}
                onClick={() => onPageChange(item)}
                aria-current={item === safePage ? 'page' : undefined}
              >
                {item}
              </button>
            ) : (
              <span key={item} className="lb-page-ellipsis">
                …
              </span>
            ),
          )}
        </div>

        <span className="lb-page-indicator">
          Page {safePage} of {pageCount}
        </span>

        <button
          type="button"
          className="lb-page-button lb-page-nav"
          onClick={() => onPageChange(Math.min(pageCount, safePage + 1))}
          disabled={safePage >= pageCount}
        >
          <span>Next</span>
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}

export default function LeaveBalances({ user = {} }) {
  const canManage = canManageLeaveBalances(user);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [balanceItems, setBalanceItems] = useState([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [employeeQuery, setEmployeeQuery] = useState('');
  const [tableQuery, setTableQuery] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [balanceFilter, setBalanceFilter] = useState('all');
  const [exportPeriod, setExportPeriod] = useState('current');
  const [exportDate, setExportDate] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');
  const [exporting, setExporting] = useState(false);
  const [casualLeaveToAdd, setCasualLeaveToAdd] = useState('');
  const [earnedLeaveToAdd, setEarnedLeaveToAdd] = useState('');
  const [showBalanceCorrection, setShowBalanceCorrection] = useState(false);
  const [correctionLeaveType, setCorrectionLeaveType] = useState('CL');
  const [correctionAvailable, setCorrectionAvailable] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [pendingBalanceCorrection, setPendingBalanceCorrection] = useState(null);
  const confirmationButtonRef = useRef(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [feedbackMap, setFeedbackMap] = useState({});
  const feedbackTimersRef = useRef({});

  useEffect(() => {
    if (!pendingBalanceCorrection) return undefined;
    const previousFocus = document.activeElement;
    confirmationButtonRef.current?.focus();
    function onKeyDown(event) {
      if (event.key === 'Escape' && !saving) {
        setPendingBalanceCorrection(null);
      }
      if (event.key === 'Tab') {
        const dialog = document.getElementById('lb-balance-confirm-dialog');
        const focusables = dialog?.querySelectorAll('button:not([disabled])');
        if (!focusables?.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus?.();
    };
  }, [pendingBalanceCorrection, saving]);

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

  const departmentOptions = useMemo(() => [...new Set(balanceRows.map((row) => row.department).filter(Boolean))].sort(), [balanceRows]);

  const visibleRows = useMemo(() => {
    const query = tableQuery.trim().toLowerCase();
    return balanceRows.filter((row) => {
      if (departmentFilter && row.department !== departmentFilter) return false;
      if (query && ![
        row.employee_name, row.employee_code, row.department, row.designation,
      ].filter(Boolean).join(' ').toLowerCase().includes(query)) return false;
      const kinds = typeFilter === 'ALL' ? ['cl', 'el'] : [typeFilter.toLowerCase()];
      if (balanceFilter === 'all') return true;
      return kinds.some((kind) => {
        const available = toNumber(row[kind]?.available, 0);
        if (balanceFilter === 'zero') return available === 0;
        if (balanceFilter === 'positive') return available > 0;
        return available < 0;
      });
    });
  }, [balanceRows, tableQuery, departmentFilter, typeFilter, balanceFilter]);

  useEffect(() => { setPage(1); }, [tableQuery, departmentFilter, typeFilter, balanceFilter]);

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
  const totalLeaveAvailable = totals.casual + totals.earned;

  const pageCount = Math.max(
    1,
    Math.ceil(visibleRows.length / Math.max(1, Number(pageSize || 10))),
  );
  const safePage = Math.min(Math.max(1, page), pageCount);
  const pageStart = (safePage - 1) * pageSize;
  const pagedRows = visibleRows.slice(pageStart, pageStart + pageSize);

  async function downloadBalanceReport() {
    if (exporting || loading) return;
    if (exportPeriod === 'custom' && (!exportFrom || !exportTo || exportFrom > exportTo)) {
      showFeedback('export', 'warning', 'Choose a valid start and end date.', 'Invalid Date Range');
      return;
    }
    setExporting(true);
    try {
      const params = {
        period: exportPeriod, search: tableQuery, department: departmentFilter,
        leave_type: typeFilter, balance_filter: balanceFilter,
      };
      if (exportPeriod === 'weekly' || exportPeriod === 'monthly') params.on_date = exportDate;
      if (exportPeriod === 'custom') {
        params.date_from = exportFrom;
        params.date_to = exportTo;
      }
      const blob = await exportLeaveBalancesWorkbook(params);
      const filename = `YourComate_Leave_Balances_${exportPeriod}_${exportPeriod === 'custom' ? exportFrom + '_to_' + exportTo : exportDate}.xlsx`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      showFeedback('export', 'success', 'Excel report downloaded successfully.', 'Export Complete');
    } catch (error) {
      showFeedback('export', 'error', error.message || 'Excel export failed.', 'Export Failed');
    } finally {
      setExporting(false);
    }
  }

  function clearFeedback(scopeKey) {
    if (!scopeKey) return;

    const timer = feedbackTimersRef.current[scopeKey];

    if (timer) {
      window.clearTimeout(timer);
      delete feedbackTimersRef.current[scopeKey];
    }

    setFeedbackMap((current) => {
      if (!Object.prototype.hasOwnProperty.call(current, scopeKey)) {
        return current;
      }

      const next = { ...current };
      delete next[scopeKey];
      return next;
    });
  }

  function showFeedback(
    scopeKey,
    type,
    text,
    title = '',
    options = {},
  ) {
    if (!scopeKey) return;

    const timer = feedbackTimersRef.current[scopeKey];

    if (timer) {
      window.clearTimeout(timer);
      delete feedbackTimersRef.current[scopeKey];
    }

    setFeedbackMap((current) => ({
      ...current,
      [scopeKey]: {
        type,
        text,
        title,
        loading: Boolean(options.loading),
      },
    }));

    if (!options.loading) {
      feedbackTimersRef.current[scopeKey] = window.setTimeout(() => {
        setFeedbackMap((current) => {
          const next = { ...current };
          delete next[scopeKey];
          return next;
        });

        delete feedbackTimersRef.current[scopeKey];
      }, LEAVE_BALANCE_NOTICE_HIDE_MS);
    }
  }

  async function loadData({
    showLoader = true,
    feedbackScope = '',
  } = {}) {
    if (!canManage) {
      setLoading(false);
      return false;
    }

    if (showLoader) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    if (feedbackScope) {
      showFeedback(
        feedbackScope,
        'info',
        'Refreshing employee leave balances...',
        'Refreshing',
        { loading: true },
      );
    }

    try {
      const [employeeResponse, balanceResponse] = await Promise.all([
        listCollection('employees', {
          limit: 1000,
          sort_by: 'name',
          sort_dir: 'asc',
          employee_scope: 'active',
        }),
        getLeaveBalances({ limit: 1000 }),
      ]);

      const activeEmployees = toArray(employeeResponse).filter(isActiveEmployee);

      setEmployees(activeEmployees);
      setBalanceItems(toArray(balanceResponse));
      setSelectedEmployeeId((currentEmployeeId) =>
        activeEmployees.some(
          (employee) => getEmployeeId(employee) === currentEmployeeId,
        )
          ? currentEmployeeId
          : '',
      );

      if (feedbackScope) {
        showFeedback(
          feedbackScope,
          'success',
          'Employee leave balances are up to date.',
          'Refresh Complete',
        );
      }

      return true;
    } catch (error) {
      showFeedback(
        feedbackScope || 'page',
        'error',
        error.message || 'Unable to load employee leave balances.',
        feedbackScope ? 'Refresh Failed' : 'Leave Balances Load Failed',
      );

      return false;
    } finally {
      if (showLoader) {
        setLoading(false);
      } else {
        setRefreshing(false);
      }
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage]);

  useEffect(() => {
    setPage(1);
  }, [tableQuery, pageSize]);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  useEffect(() => {
    function dismissFeedback(event) {
      if (event.target?.closest?.('.lb-inline-feedback')) return;

      Object.values(feedbackTimersRef.current).forEach((timer) => {
        window.clearTimeout(timer);
      });

      feedbackTimersRef.current = {};
      setFeedbackMap({});
    }

    document.addEventListener('pointerdown', dismissFeedback);

    return () => {
      document.removeEventListener('pointerdown', dismissFeedback);

      Object.values(feedbackTimersRef.current).forEach((timer) => {
        window.clearTimeout(timer);
      });

      feedbackTimersRef.current = {};
    };
  }, []);

  function selectEmployee(
    employeeId,
    {
      showSelectionFeedback = false,
      feedbackScope = '',
    } = {},
  ) {
    const normalizedEmployeeId = String(employeeId || '');

    setSelectedEmployeeId(normalizedEmployeeId);
    setCasualLeaveToAdd('');
    setEarnedLeaveToAdd('');
    setCorrectionAvailable('');
    setCorrectionReason('');
    setShowBalanceCorrection(false);

    if (!showSelectionFeedback || !normalizedEmployeeId) {
      return;
    }

    const employee = employees.find(
      (item) => getEmployeeId(item) === normalizedEmployeeId,
    );
    const message = `${getEmployeeName(
      employee || {},
    )} is selected for leave allocation.`;

    showFeedback(
      'form-action',
      'success',
      message,
      'Employee Selected',
    );

    if (feedbackScope) {
      showFeedback(
        feedbackScope,
        'success',
        message,
        'Employee Selected',
      );
    }
  }

  async function addLeave(event) {
    event.preventDefault();
    clearFeedback('form-action');

    if (!selectedEmployeeId) {
      showFeedback(
        'form-action',
        'warning',
        'Please select an employee.',
        'Employee Required',
      );
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
      showFeedback(
        'form-action',
        'warning',
        'Leave to add must be zero or a positive number.',
        'Invalid Leave Value',
      );
      return;
    }

    if (rawCasualLeave === 0 && rawEarnedLeave === 0) {
      showFeedback(
        'form-action',
        'warning',
        'Enter Casual Leave or Earned Leave to add.',
        'Leave Value Required',
      );
      return;
    }

    setSaving(true);

    showFeedback(
      'form-action',
      'info',
      'Saving the employee leave balance...',
      'Adding Leave',
      { loading: true },
    );

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

      const optimisticRows = [];

      if (rawCasualLeave > 0) {
        optimisticRows.push({
          employee_id: selectedEmployeeId,
          leave_type: 'CL',
          opening_balance: selectedBalance.cl.opening_balance,
          credited: selectedBalance.cl.credited + rawCasualLeave,
          used: selectedBalance.cl.used,
          available: selectedBalance.cl.available + rawCasualLeave,
          status: selectedBalance.cl.status || 'active',
        });
      }

      if (rawEarnedLeave > 0) {
        optimisticRows.push({
          employee_id: selectedEmployeeId,
          leave_type: 'EL',
          opening_balance: selectedBalance.el.opening_balance,
          credited: selectedBalance.el.credited + rawEarnedLeave,
          used: selectedBalance.el.used,
          available: selectedBalance.el.available + rawEarnedLeave,
          status: selectedBalance.el.status || 'active',
        });
      }

      if (optimisticRows.length) {
        setBalanceItems((currentItems) => [
          ...currentItems,
          ...optimisticRows,
        ]);
      }

      setCasualLeaveToAdd('');
      setEarnedLeaveToAdd('');

      const additions = [];

      if (rawCasualLeave > 0) {
        additions.push(
          `${formatLeaveDays(rawCasualLeave)} Casual Leave`,
        );
      }

      if (rawEarnedLeave > 0) {
        additions.push(
          `${formatLeaveDays(rawEarnedLeave)} Earned Leave`,
        );
      }

      showFeedback(
        'form-action',
        'success',
        `${additions.join(' and ')} added to ${getEmployeeName(
          selectedEmployee,
        )}.`,
        'Leave Added Successfully',
      );

      void loadData({
        showLoader: false,
      });
    } catch (error) {
      showFeedback(
        'form-action',
        'error',
        error.message || 'Unable to add leave for this employee.',
        'Add Leave Failed',
      );
    } finally {
      setSaving(false);
    }
  }

  async function saveBalanceCorrection(event) {
    event.preventDefault();
    clearFeedback('balance-correction');
    if (!selectedEmployeeId) return;
    if (correctionAvailable.trim() === '' || !Number.isFinite(Number(correctionAvailable)) ||
        Number(correctionAvailable) < 0 || Number(correctionAvailable) * 2 !== Math.round(Number(correctionAvailable) * 2)) {
      showFeedback('balance-correction', 'warning', 'Enter a non-negative balance in half-day increments, including 0.', 'Invalid Balance');
      return;
    }
    if (correctionReason.trim().length < 5) {
      showFeedback('balance-correction', 'warning', 'Enter a reason of at least five characters.', 'Reason Required');
      return;
    }
    const existing = correctionLeaveType === 'CL' ? selectedBalance.cl : selectedBalance.el;
    setPendingBalanceCorrection({
      employeeId: selectedEmployeeId,
      employeeName: getEmployeeName(selectedEmployee),
      leaveType: correctionLeaveType,
      previousAvailable: existing.available,
      targetAvailable: Number(correctionAvailable),
      reason: correctionReason.trim(),
    });
  }

  async function confirmBalanceCorrection() {
    if (!pendingBalanceCorrection || saving) return;
    const correction = pendingBalanceCorrection;
    setSaving(true);
    try {
      await correctLeaveAvailableBalance(correction.employeeId, {
        leave_type: correction.leaveType,
        available: correction.targetAvailable,
        expected_available: correction.previousAvailable,
        reason: correction.reason,
      });
      setPendingBalanceCorrection(null);
      // Use refreshed server values, rather than optimistic local arithmetic.
      await loadData({ showLoader: false });
      setCorrectionAvailable('');
      setCorrectionReason('');
      showFeedback('balance-correction', 'success', `Updated ${correction.leaveType} available balance to ${formatLeaveDays(correction.targetAvailable)} days. Previous values and reason were recorded for audit.`, 'Balance Corrected');
    } catch (error) {
      setPendingBalanceCorrection(null);
      showFeedback('balance-correction', 'error', error.message || 'Unable to correct leave balance.', 'Correction Failed');
    } finally {
      setSaving(false);
    }
  }

  const pageStyles = `

    .lb-report-filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(165px, 1fr)); gap: 12px; padding: 16px; background: #f7f9fd; border: 1px solid rgba(77,119,221,.15); border-radius: 18px; margin: 14px 0 16px; }
    .lb-report-filters label { display: grid; gap: 6px; font-size: 12px; font-weight: 800; color: #52617f; }
    .lb-report-filters select, .lb-report-filters input { width: 100%; min-height: 40px; border: 1px solid #d9e1f1; background: #fff; border-radius: 10px; padding: 8px 10px; color: #172545; font: inherit; font-weight: 600; }
    .lb-report-export { display: flex; gap: 12px; flex-wrap: wrap; align-items: end; padding: 16px; border: 1px solid rgba(77,119,221,.15); border-radius: 18px; margin-bottom: 16px; background: #fff; }
    .lb-report-export label { display: grid; gap: 6px; font-size: 12px; font-weight: 800; color: #52617f; }
    .lb-report-export select, .lb-report-export input { min-width: 154px; min-height: 40px; border: 1px solid #d9e1f1; background: #fff; border-radius: 10px; padding: 8px 10px; color: #172545; font: inherit; }
    .lb-report-note { color: #677795; font-size: 12px; margin: -3px 0 14px; line-height: 1.55; }

    .leave-balances-page {
      --lb-ink: #101a3a;
      --lb-copy: #5d6d8d;
      --lb-blue: #4d77dd;
      --lb-cyan: #2eb2b9;
      --lb-violet: #575092;
      --lb-line: rgba(16, 26, 58, .14);
      width: 100%;
      min-width: 0;
      display: grid;
      gap: clamp(16px, 1.8vw, 24px);
      color: var(--lb-ink);
    }

    .leave-balances-page,
    .leave-balances-page * {
      box-sizing: border-box;
    }

    .leave-balances-page > *,
    .leave-balances-page section,
    .leave-balances-page article,
    .leave-balances-page form,
    .leave-balances-page label {
      min-width: 0;
      max-width: 100%;
    }

    .leave-balances-page::before,
    .leave-balances-page::after,
    .lb-hero::before,
    .lb-hero::after,
    .lb-summary-card::before,
    .lb-summary-card::after {
      content: none;
      display: none;
      background: none;
    }

    .lb-hero {
      position: relative;
      isolation: isolate;
      overflow: hidden;
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(230px, 330px);
      gap: clamp(20px, 3vw, 38px);
      align-items: center;
      min-height: 240px;
      padding: clamp(24px, 3vw, 40px);
      border: 1px solid rgba(154, 164, 205, .58);
      border-radius: clamp(28px, 2.7vw, 40px);
      background:
        linear-gradient(
          90deg,
          #d3f4fb 0%,
          #f7fcfb 34%,
          #fffdf8 52%,
          #fbf8fa 68%,
          #f0edfb 100%
        );
      box-shadow: 0 22px 46px rgba(70, 92, 140, .10);
    }

    .lb-hero-copy {
      min-width: 0;
      max-width: 900px;
    }

    .lb-kicker,
    .lb-section-kicker {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      width: max-content;
      max-width: 100%;
      border-radius: 999px;
      color: #fff;
      background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
      font-size: 9px;
      font-weight: 950;
      line-height: 1;
      letter-spacing: .12em;
      text-transform: uppercase;
    }

    .lb-kicker {
      margin-bottom: 15px;
      padding: 9px 13px;
      box-shadow: 0 8px 18px rgba(77, 119, 221, .18);
    }

    .lb-section-kicker {
      margin-bottom: 10px;
      padding: 7px 10px;
      box-shadow: 0 7px 15px rgba(77, 119, 221, .14);
    }

    .lb-hero h1 {
      max-width: 900px;
      margin: 0;
      color: var(--lb-ink);
      font-family: var(--yc-display, Georgia, "Times New Roman", serif);
      font-size: clamp(44px, 5.2vw, 76px);
      font-weight: 760;
      line-height: .94;
      letter-spacing: -.058em;
    }

    .lb-hero h1 em {
      color: var(--lb-blue);
      font-family: Georgia, "Times New Roman", serif;
      font-weight: 500;
    }

    .lb-hero p {
      max-width: 780px;
      margin: 17px 0 0;
      color: var(--lb-copy);
      font-size: clamp(13px, 1vw, 16px);
      line-height: 1.68;
    }

    .lb-hero-note {
      padding: 17px;
      border: 1px solid rgba(77, 119, 221, .18);
      border-radius: 18px;
      background: rgba(255, 255, 255, .88);
      box-shadow: 0 12px 26px rgba(70, 92, 140, .08);
    }

    .lb-hero-note strong,
    .lb-hero-note span {
      display: block;
    }

    .lb-hero-note strong {
      color: var(--lb-ink);
      font-size: 13px;
    }

    .lb-hero-note span {
      margin-top: 7px;
      color: var(--lb-copy);
      font-size: 11px;
      line-height: 1.5;
    }

    .lb-summary-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 14px;
    }

    .lb-summary-card {
      min-width: 0;
      min-height: 120px;
      padding: 18px;
      border: 1px solid rgba(171, 181, 211, .66);
      border-radius: 22px;
      background: #edf6ff;
      box-shadow: 0 16px 30px rgba(34, 38, 110, .07);
    }

    .lb-summary-card:nth-child(2) {
      background: #eaf8f4;
    }

    .lb-summary-card:nth-child(3) {
      background: #fff4d5;
    }

    .lb-summary-card:nth-child(4) {
      background: #f1efff;
    }

    .lb-summary-card span,
    .lb-summary-card strong,
    .lb-summary-card small {
      display: block;
    }

    .lb-summary-card span {
      color: #5d6785;
      font-size: 9px;
      font-weight: 950;
      letter-spacing: .09em;
      text-transform: uppercase;
    }

    .lb-summary-card strong {
      margin-top: 8px;
      color: var(--lb-ink);
      font-family: Georgia, "Times New Roman", serif;
      font-size: clamp(28px, 3vw, 42px);
      line-height: 1;
    }

    .lb-summary-card small {
      margin-top: 7px;
      color: var(--lb-copy);
      font-size: 11px;
      line-height: 1.45;
    }

    .lb-page-feedback {
      width: min(620px, 100%);
    }

    .lb-inline-feedback {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: 9px;
      align-items: start;
      width: 100%;
      min-width: 0;
      padding: 10px 11px;
      border: 1px solid rgba(102, 88, 220, .18);
      border-radius: 12px;
      color: #40348d;
      background: #f1efff;
      font-size: 10px;
      line-height: 1.45;
    }

    .lb-inline-feedback.success {
      border-color: rgba(4, 120, 87, .18);
      color: #047857;
      background: #eaf8f4;
    }

    .lb-inline-feedback.warning {
      border-color: rgba(154, 104, 23, .18);
      color: #9a6817;
      background: #fff4d5;
    }

    .lb-inline-feedback.error {
      border-color: rgba(162, 52, 77, .18);
      color: #a2344d;
      background: #fff0f2;
    }

    .lb-inline-feedback-icon {
      width: 22px;
      height: 22px;
      display: inline-grid;
      place-items: center;
    }

    .lb-inline-feedback-copy {
      min-width: 0;
    }

    .lb-inline-feedback-copy strong,
    .lb-inline-feedback-copy span {
      display: block;
      overflow-wrap: anywhere;
    }

    .lb-inline-feedback-copy strong {
      margin-bottom: 2px;
      font-weight: 950;
    }

    .lb-inline-feedback-copy span {
      font-weight: 750;
    }

    .lb-inline-feedback-close {
      width: 24px;
      min-width: 24px;
      height: 24px;
      padding: 0;
      border: 0;
      border-radius: 8px;
      display: inline-grid;
      place-items: center;
      color: currentColor;
      background: rgba(255, 255, 255, .58);
      font: inherit;
      font-size: 17px;
      line-height: 1;
      cursor: pointer;
    }

    .lb-inline-feedback-close:hover {
      background: #fff;
    }

    .lb-workspace {
      display: grid;
      grid-template-columns: minmax(0, 1.18fr) minmax(300px, .82fr);
      gap: 18px;
      align-items: stretch;
    }

    .lb-card,
    .lb-table-card {
      min-width: 0;
      border: 1px solid rgba(171, 181, 211, .70);
      border-radius: clamp(24px, 2.2vw, 34px);
      background: #fff;
      box-shadow: 0 20px 38px rgba(34, 38, 110, .08);
    }

    .lb-card {
      padding: clamp(20px, 2vw, 28px);
    }

    .lb-card:first-child {
      background:
        linear-gradient(
          145deg,
          rgba(239, 248, 255, .72),
          rgba(248, 244, 255, .62) 52%,
          rgba(255, 250, 238, .68)
        );
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
      color: var(--lb-ink);
      font-family: var(--yc-display, Georgia, "Times New Roman", serif);
      font-size: clamp(24px, 2.4vw, 35px);
      font-weight: 760;
      line-height: 1;
      letter-spacing: -.045em;
    }

    .lb-card-head p,
    .lb-table-head p {
      margin: 8px 0 0;
      color: var(--lb-copy);
      font-size: 13px;
      line-height: 1.55;
    }

    .lb-card-head > svg {
      color: var(--lb-blue);
      flex: 0 0 auto;
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
      color: #303b5b;
      font-size: 11px;
      font-weight: 900;
      letter-spacing: .025em;
    }

    .lb-field input,
    .lb-field select {
      width: 100%;
      min-width: 0;
      min-height: 50px;
      padding: 0 14px;
      border: 1px solid rgba(151, 161, 197, .58);
      border-radius: 14px;
      outline: 0;
      color: var(--lb-ink);
      background: rgba(255, 255, 255, .96);
      font: inherit;
      font-size: 13px;
      transition:
        border-color 170ms ease,
        box-shadow 170ms ease;
    }

    .lb-field input:focus,
    .lb-field select:focus {
      border-color: rgba(77, 119, 221, .65);
      box-shadow: 0 0 0 4px rgba(77, 119, 221, .09);
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
      border: 1px solid rgba(171, 181, 211, .52);
      border-radius: 16px;
      background: #f8fbff;
    }

    .lb-leave-input:nth-child(2) {
      background: #f4fbf8;
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
      color: #40348d;
    }

    .lb-form-action-stack,
    .lb-refresh-stack {
      display: grid;
      gap: 9px;
      min-width: 0;
    }

    .lb-form-action-stack {
      width: 100%;
    }

    .lb-refresh-stack {
      width: 100%;
      align-items: start;
    }

    .lb-primary-btn,
    .lb-soft-btn {
      min-height: 44px;
      padding: 10px 15px;
      border: 1px solid transparent;
      border-radius: 14px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: max-content;
      font: inherit;
      font-size: 12px;
      font-weight: 900;
      cursor: pointer;
      transition:
        transform 180ms ease,
        border-color 180ms ease,
        filter 180ms ease,
        opacity 180ms ease;
    }

    .lb-primary-btn {
      min-width: 160px;
      color: #fff;
      background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
      box-shadow: 0 10px 22px rgba(77, 119, 221, .18);
    }

    .lb-soft-btn {
      color: #4767b4;
      border-color: rgba(77, 119, 221, .18);
      background: #fff;
    }

    .lb-primary-btn:hover:not(:disabled),
    .lb-soft-btn:hover:not(:disabled) {
      transform: translateY(-1px);
      border-color: rgba(46, 178, 185, .42);
      filter: saturate(1.03);
    }

    .lb-primary-btn:disabled,
    .lb-soft-btn:disabled {
      cursor: not-allowed;
      opacity: .55;
      transform: none;
    }

    .lb-spin {
      animation: lbSpin .82s linear infinite;
    }

    @keyframes lbSpin {
      to {
        transform: rotate(360deg);
      }
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
      color: var(--lb-blue);
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
      color: #40348d;
      background: linear-gradient(135deg, #edf6ff, #eaf8f4);
      border: 3px solid #fff;
      box-shadow: 0 8px 20px rgba(50, 57, 102, .12);
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
      border: 1px solid rgba(171, 181, 211, .52);
      border-radius: 16px;
      background: #edf6ff;
    }

    .lb-balance-box:nth-child(2) {
      background: #eaf8f4;
    }

    .lb-balance-box > span,
    .lb-balance-box > strong {
      display: block;
    }

    .lb-balance-box > span {
      color: var(--lb-copy);
      font-size: 10px;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: .06em;
    }

    .lb-balance-box > strong {
      margin: 5px 0 12px;
      color: #40348d;
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
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      padding: 22px 24px;
      border-bottom: 1px solid rgba(65, 55, 161, .08);
    }

    .lb-table-tools {
      display: grid;
      grid-template-columns:
        minmax(280px, 350px)
        minmax(160px, 300px);
      align-items: start;
      justify-content: end;
      gap: 14px;
    }

    .lb-search-box {
      position: relative;
      display: block;
      width: 100%;
      min-width: 0;
    }

    .lb-search-box > svg {
      position: absolute;
      top: 50%;
      left: 13px;
      color: var(--lb-blue);
      transform: translateY(-50%);
      pointer-events: none;
    }

    .lb-search-box input {
      width: 100%;
      min-height: 44px;
      padding: 0 13px 0 39px;
      border: 1px solid rgba(151, 161, 197, .58);
      border-radius: 14px;
      outline: 0;
      color: var(--lb-ink);
      background: #fff;
      font: inherit;
      font-size: 13px;
    }

    .lb-search-box input:focus {
      border-color: rgba(77, 119, 221, .65);
      box-shadow: 0 0 0 4px rgba(77, 119, 221, .09);
    }

    .lb-refresh-stack .lb-soft-btn {
      width: max-content;
      min-width: 145px;
      justify-self: start;
    }

    .lb-refresh-stack .lb-inline-feedback {
      width: 100%;
    }

    .lb-pagination-view {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      padding: 13px clamp(18px, 2vw, 24px);
      border-bottom: 1px solid rgba(65, 55, 161, .08);
      background: #fff;
    }

    .lb-pagination-copy {
      display: inline-flex;
      align-items: baseline;
      gap: 6px;
      color: var(--lb-copy);
      font-size: 10px;
      font-weight: 800;
    }

    .lb-pagination-copy strong {
      color: var(--lb-ink);
      font-size: 13px;
    }

    .lb-page-size {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      color: var(--lb-copy);
      font-size: 10px;
      font-weight: 900;
      white-space: nowrap;
    }

    .lb-page-size select {
      width: auto;
      min-width: 78px;
      min-height: 38px;
      padding: 0 28px 0 10px;
      border: 1px solid rgba(151, 161, 197, .58);
      border-radius: 12px;
      outline: 0;
      color: #40348d;
      background: #f1efff;
      font: inherit;
      font-size: 10px;
      font-weight: 900;
    }

    .lb-page-size select:focus {
      border-color: rgba(77, 119, 221, .65);
      box-shadow: 0 0 0 4px rgba(77, 119, 221, .09);
    }

    .lb-table-wrap {
      width: 100%;
      max-width: 100%;
      overflow-x: auto;
      background: #fff;
      -webkit-overflow-scrolling: touch;
      overscroll-behavior-x: contain;
      touch-action: pan-x pan-y;
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
      vertical-align: top;
    }

    .lb-table th {
      color: #526079;
      background: linear-gradient(180deg, #f8f8ff, #f4f8fb);
      font-size: 10px;
      font-weight: 950;
      letter-spacing: .07em;
      text-transform: uppercase;
    }

    .lb-table td {
      color: #334155;
      font-size: 13px;
    }

    .lb-table tr:hover td {
      background: #fafcff;
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
      color: #40348d;
      background: #f1efff;
      font-weight: 900;
    }

    .lb-number-pill.is-earned {
      color: #047857;
      background: #eaf8f4;
    }

    .lb-row-action-stack {
      display: grid;
      gap: 7px;
      width: min(220px, 100%);
    }

    .lb-row-action-stack .lb-soft-btn {
      justify-self: start;
    }

    .lb-pagination {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 14px;
      padding: 13px clamp(18px, 2vw, 24px);
      border-top: 1px solid rgba(65, 55, 161, .08);
      background: #fff;
    }

    .lb-pagination-controls {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      flex-wrap: wrap;
    }

    .lb-page-button,
    .lb-page-number {
      border: 1px solid rgba(77, 119, 221, .18);
      color: #4767b4;
      background: #fff;
      font: inherit;
      font-size: 10px;
      font-weight: 900;
      cursor: pointer;
      transition:
        transform 180ms ease,
        border-color 180ms ease,
        background 180ms ease;
    }

    .lb-page-button {
      min-width: 38px;
      height: 38px;
      padding: 0 10px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      border-radius: 11px;
    }

    .lb-page-nav {
      min-width: 78px;
    }

    .lb-page-numbers {
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .lb-page-number {
      width: 36px;
      height: 36px;
      padding: 0;
      display: grid;
      place-items: center;
      border-radius: 10px;
    }

    .lb-page-number.is-active {
      border-color: transparent;
      color: #fff;
      background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
    }

    .lb-page-button:hover:not(:disabled),
    .lb-page-number:hover:not(:disabled) {
      transform: translateY(-1px);
      border-color: rgba(46, 178, 185, .42);
    }

    .lb-page-button:disabled,
    .lb-page-number:disabled {
      opacity: .5;
      cursor: not-allowed;
      transform: none;
    }

    .lb-page-ellipsis {
      width: 18px;
      text-align: center;
      color: #7b88a5;
      font-weight: 900;
    }

    .lb-page-indicator {
      min-width: 82px;
      color: var(--lb-copy);
      font-size: 10px;
      font-weight: 900;
      text-align: center;
      white-space: nowrap;
    }

    .lb-empty {
      padding: 38px 20px;
      color: var(--lb-copy);
      text-align: center;
    }

    .lb-restricted {
      min-height: 360px;
      padding: 30px;
      border: 1px solid rgba(171, 181, 211, .70);
      border-radius: 28px;
      display: grid;
      place-items: center;
      align-content: center;
      gap: 10px;
      color: var(--lb-copy);
      background: linear-gradient(145deg, #f8fbff, #f8f7ff);
      text-align: center;
      box-shadow: 0 18px 34px rgba(34, 38, 110, .07);
    }

    .lb-restricted h1,
    .lb-restricted p {
      margin: 0;
    }

    .lb-restricted svg {
      color: var(--lb-blue);
    }

    .lb-confirm-overlay {
      position: fixed;
      inset: 0;
      z-index: 5000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: rgba(13, 23, 48, .58);
      backdrop-filter: blur(5px);
      animation: lb-confirm-fade .18s ease both;
    }
    .lb-confirm-dialog {
      width: min(100%, 470px);
      border: 1px solid rgba(192, 204, 231, .7);
      border-radius: 22px;
      padding: 28px;
      background: #fff;
      box-shadow: 0 26px 76px rgba(13, 23, 48, .28);
      animation: lb-confirm-rise .2s ease both;
      color: #172344;
    }
    .lb-confirm-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .lb-confirm-icon {
      width: 54px;
      height: 54px;
      border-radius: 17px;
      display: grid;
      place-items: center;
      color: #4d68c9;
      background: #edf2ff;
    }
    .lb-confirm-close {
      width: 36px;
      height: 36px;
      display: grid;
      place-items: center;
      border: 0;
      border-radius: 11px;
      background: #f2f5fa;
      color: #576580;
      cursor: pointer;
    }
    .lb-confirm-dialog h2 { margin: 18px 0 8px; font-size: 23px; font-weight: 750; line-height: 1.25; }
    .lb-confirm-description { margin: 0 0 20px; line-height: 1.55; color: #62718e; font-size: 14px; }
    .lb-confirm-employee { margin-bottom: 12px; font-weight: 700; font-size: 14px; }
    .lb-confirm-balance {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      gap: 10px;
      align-items: center;
      padding: 16px;
      border-radius: 15px;
      background: #f5f7fc;
      border: 1px solid #e8ecf5;
    }
    .lb-confirm-balance div { display: grid; gap: 4px; }
    .lb-confirm-balance span { font-size: 12px; color: #697997; }
    .lb-confirm-balance strong { font-size: 22px; font-weight: 800; }
    .lb-confirm-balance .lb-confirm-new { color: #365bba; }
    .lb-confirm-balance svg { color: #8090ad; }
    .lb-confirm-reason { margin: 14px 0 0; font-size: 13px; color: #62718e; overflow-wrap: anywhere; }
    .lb-confirm-reason strong { color: #334363; }
    .lb-confirm-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 24px; }
    .lb-confirm-actions button {
      border-radius: 11px;
      border: 1px solid #dbe2f0;
      padding: 11px 18px;
      min-height: 44px;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    .lb-confirm-cancel { color: #4d5d7a; background: white; }
    .lb-confirm-submit { color: white; background: #436bd0; border-color: #436bd0 !important; display: inline-flex; align-items: center; gap: 8px; }
    .lb-confirm-actions button:disabled { cursor: not-allowed; opacity: .65; }
    .lb-confirm-actions button:focus-visible, .lb-confirm-close:focus-visible { outline: 3px solid #a5bfff; outline-offset: 2px; }
    @keyframes lb-confirm-fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes lb-confirm-rise { from { transform: translateY(10px) scale(.98); opacity: .7; } to { transform: translateY(0) scale(1); opacity: 1; } }
    @media (max-width: 520px) {
      .lb-confirm-dialog { padding: 20px; border-radius: 18px; }
      .lb-confirm-actions { flex-direction: column-reverse; }
      .lb-confirm-actions button { width: 100%; justify-content: center; }
    }

    @media (max-width: 1180px) {
      .lb-summary-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .lb-pagination-controls {
        width: 100%;
        justify-content: flex-end;
      }
    }

    @media (max-width: 980px) {
      .lb-hero,
      .lb-workspace {
        grid-template-columns: 1fr;
      }

      .lb-hero-note {
        width: min(520px, 100%);
      }

      .lb-table-head {
        align-items: stretch;
        flex-direction: column;
      }

      .lb-table-tools {
        width: 100%;
        grid-template-columns:
          minmax(260px, 350px)
          minmax(160px, 300px);
        justify-content: start;
      }
    }

    @media (max-width: 760px) {
      .leave-balances-page {
        gap: 15px;
      }

      .lb-hero {
        min-height: 0;
        padding: 20px;
        border-radius: 26px;
        box-shadow: 0 18px 30px rgba(34, 38, 110, .09);
      }

      .lb-hero h1 {
        font-size: clamp(36px, 10vw, 52px);
      }

      .lb-input-grid,
      .lb-balance-pair {
        grid-template-columns: 1fr;
      }

      .lb-table-tools {
        width: 100%;
        grid-template-columns: minmax(0, 1fr);
        justify-content: start;
        gap: 12px;
      }

      .lb-search-box {
        width: min(360px, 100%);
      }

      .lb-refresh-stack {
        width: min(320px, 100%);
      }

      .lb-refresh-stack .lb-soft-btn {
        width: max-content;
        min-width: 145px;
      }

      .lb-pagination-view,
      .lb-pagination {
        padding: 12px;
      }

      .lb-pagination-view {
        align-items: center;
      }

      .lb-pagination-controls {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        align-items: stretch;
      }

      .lb-page-numbers,
      .lb-page-indicator {
        grid-column: 1 / -1;
        justify-self: stretch;
      }

      .lb-page-numbers {
        justify-content: center;
        flex-wrap: wrap;
      }

      .lb-page-size {
        justify-content: flex-end;
      }

      .lb-page-nav {
        width: 100%;
      }

      .lb-card {
        padding: 18px;
        border-radius: 24px;
      }
    }

    @media (max-width: 520px) {
      .lb-summary-grid {
        grid-template-columns: 1fr;
      }

      .lb-pagination-view {
        align-items: stretch;
        flex-direction: column;
      }

      .lb-page-size {
        justify-content: space-between;
      }

      .lb-page-size select {
        flex: 1 1 auto;
      }

      .lb-primary-btn,
      .lb-form-action-stack,
      .lb-search-box,
      .lb-refresh-stack,
      .lb-refresh-stack .lb-soft-btn {
        width: 100%;
      }
    }

    @media (max-width: 390px) {
      .lb-hero {
        padding: 16px;
      }

      .lb-hero h1 {
        font-size: clamp(32px, 11vw, 44px);
      }

      .lb-page-number {
        width: 34px;
        height: 34px;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .leave-balances-page *,
      .leave-balances-page *::before,
      .leave-balances-page *::after {
        animation: none !important;
        transition: none !important;
      }
    }
  `;

  return (
    <div className="leave-balances-page">
      <style>{pageStyles}</style>
      {pendingBalanceCorrection && canManage ? (
        <div className="lb-confirm-overlay" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !saving) setPendingBalanceCorrection(null);
        }}>
          <section
            id="lb-balance-confirm-dialog"
            className="lb-confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="lb-confirm-title"
            aria-describedby="lb-confirm-description"
          >
            <div className="lb-confirm-top">
              <span className="lb-confirm-icon"><AlertTriangle size={26} aria-hidden="true" /></span>
              <button type="button" className="lb-confirm-close" aria-label="Cancel balance correction"
                onClick={() => setPendingBalanceCorrection(null)} disabled={saving}><X size={18} /></button>
            </div>
            <h2 id="lb-confirm-title">Confirm balance correction</h2>
            <p id="lb-confirm-description" className="lb-confirm-description">
              This replaces the employee&apos;s available leave balance. It does not add extra days or remove past leave records.
            </p>
            <div className="lb-confirm-employee">
              {pendingBalanceCorrection.employeeName} · {pendingBalanceCorrection.leaveType === 'CL' ? 'Casual Leave' : 'Earned Leave'}
            </div>
            <div className="lb-confirm-balance">
              <div><span>Current balance</span><strong>{formatLeaveDays(pendingBalanceCorrection.previousAvailable)} days</strong></div>
              <ChevronRight size={20} aria-hidden="true" />
              <div><span>New balance</span><strong className="lb-confirm-new">{formatLeaveDays(pendingBalanceCorrection.targetAvailable)} days</strong></div>
            </div>
            <p className="lb-confirm-reason"><strong>Reason:</strong> {pendingBalanceCorrection.reason}</p>
            <div className="lb-confirm-actions">
              <button type="button" className="lb-confirm-cancel" disabled={saving}
                onClick={() => setPendingBalanceCorrection(null)}>Cancel</button>
              <button type="button" className="lb-confirm-submit" ref={confirmationButtonRef} disabled={saving}
                onClick={confirmBalanceCorrection}>
                {saving ? <Loader2 className="lb-spin" size={17} aria-hidden="true" /> : <CheckCircle2 size={17} aria-hidden="true" />}
                {saving ? 'Saving...' : 'Confirm & Set Balance'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {!canManage ? (
        <section className="lb-restricted">
          <CalendarDays size={34} />
          <h1>Leave Balances</h1>
          <p>
            This page can only be accessed by HR, Admin, and Super Admin.
          </p>
        </section>
      ) : (
        <>
          <section className="lb-hero">
            <div className="lb-hero-copy">
              <span className="lb-kicker">
                <CalendarDays size={14} />
                Leave Administration
              </span>

              <h1>
                Leave <em>Balances</em>
              </h1>

              <p>
                Select an employee to add leave credits or use Edit / Set Balance to correct the available amount.
              </p>
            </div>

            <div className="lb-hero-note">
              <strong>Safe balance addition</strong>
              <span>
                New leave is added to the employee&apos;s existing credit.
                Used leave and previous balance history are not reset.
              </span>
            </div>
          </section>

          <section
            className="lb-summary-grid"
            aria-label="Leave balance summary"
          >
            <article className="lb-summary-card">
              <span>Active Employees</span>
              <strong>{totals.employees}</strong>
              <small>Employees currently available for leave allocation</small>
            </article>

            <article className="lb-summary-card">
              <span>Total CL Available</span>
              <strong>{formatLeaveDays(totals.casual)}</strong>
              <small>Total Casual Leave currently available</small>
            </article>

            <article className="lb-summary-card">
              <span>Total EL Available</span>
              <strong>{formatLeaveDays(totals.earned)}</strong>
              <small>Total Earned Leave currently available</small>
            </article>

            <article className="lb-summary-card">
              <span>Total Leave Available</span>
              <strong>{formatLeaveDays(totalLeaveAvailable)}</strong>
              <small>Combined Casual Leave and Earned Leave availability</small>
            </article>
          </section>

          {feedbackMap.page ? (
            <div className="lb-page-feedback">
              <LeaveBalanceInlineMessage
                message={feedbackMap.page}
                onClose={() => clearFeedback('page')}
              />
            </div>
          ) : null}

          <section className="lb-workspace" id="leave-allocation">
            <article className="lb-card">
              <div className="lb-card-head">
                <div>
                  <span className="lb-section-kicker">
                    Leave Allocation
                  </span>
                  <h2>Add Leave</h2>
                  <p>
                    Choose the employee and enter only the leave you want to
                    add.
                  </p>
                </div>

                <Plus size={24} />
              </div>

              <form className="lb-form" onSubmit={addLeave}>
                <div className="lb-field">
                  <label htmlFor="leave-employee-search">
                    Search Employee
                  </label>
                  <input
                    id="leave-employee-search"
                    value={employeeQuery}
                    onChange={(event) =>
                      setEmployeeQuery(event.target.value)
                    }
                    placeholder="Search by name, employee ID, department or designation"
                  />
                </div>

                <div className="lb-field">
                  <label htmlFor="leave-employee-select">
                    Select Employee
                  </label>
                  <select
                    id="leave-employee-select"
                    value={selectedEmployeeId}
                    onChange={(event) =>
                      selectEmployee(event.target.value)
                    }
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
                        {employee.department
                          ? ` — ${employee.department}`
                          : ''}
                      </option>
                    ))}
                  </select>
                  <small>
                    {employeeOptions.length} matching active employee(s)
                  </small>
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
                        onChange={(event) =>
                          setCasualLeaveToAdd(event.target.value)
                        }
                        placeholder="Example: 8"
                        disabled={!selectedEmployeeId || saving}
                      />
                    </div>
                    <div className="lb-preview-line">
                      <span>After addition</span>
                      <b>
                        {formatLeaveDays(
                          selectedBalance.cl.available + casualAddition,
                        )}{' '}
                        days
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
                        onChange={(event) =>
                          setEarnedLeaveToAdd(event.target.value)
                        }
                        placeholder="Example: 15"
                        disabled={!selectedEmployeeId || saving}
                      />
                    </div>
                    <div className="lb-preview-line">
                      <span>After addition</span>
                      <b>
                        {formatLeaveDays(
                          selectedBalance.el.available + earnedAddition,
                        )}{' '}
                        days
                      </b>
                    </div>
                  </div>
                </div>

                <div className="lb-form-action-stack">
                  <button
                    type="submit"
                    className="lb-primary-btn"
                    disabled={saving || loading || !selectedEmployeeId}
                  >
                    {saving ? (
                      <Loader2 size={17} className="lb-spin" />
                    ) : (
                      <Plus size={17} />
                    )}
                    {saving ? 'Adding Leave...' : 'Add Leave'}
                  </button>

                  <LeaveBalanceInlineMessage
                    message={feedbackMap['form-action']}
                    onClose={() => clearFeedback('form-action')}
                  />
                </div>
              </form>

              <div style={{ marginTop: 20, borderTop: '1px solid #e1e6f1', paddingTop: 16 }}>
                <button
                  type="button"
                  className="lb-soft-btn"
                  disabled={saving || !selectedEmployeeId}
                  onClick={() => {
                    setShowBalanceCorrection((current) => !current);
                    setCorrectionAvailable('');
                    setCorrectionReason('');
                  }}
                >
                  {showBalanceCorrection ? 'Close Balance Editor' : 'Edit / Set Balance'}
                </button>
                {showBalanceCorrection && selectedEmployeeId ? (
                  <form className="lb-form" onSubmit={saveBalanceCorrection} style={{ marginTop: 16 }}>
                    <h3>Set exact available balance</h3>
                    <p>Use this for corrections only. This replaces the available amount; it does not add leave. Existing used leave and past requests remain unchanged.</p>
                    <div className="lb-field">
                      <label htmlFor="balance-correction-type">Leave Type</label>
                      <select id="balance-correction-type" value={correctionLeaveType} disabled={saving}
                        onChange={(event) => { setCorrectionLeaveType(event.target.value); setCorrectionAvailable(''); }}>
                        <option value="CL">Casual Leave (CL)</option>
                        <option value="EL">Earned Leave (EL)</option>
                      </select>
                    </div>
                    <p>Current available: <strong>{formatLeaveDays((correctionLeaveType === 'CL' ? selectedBalance.cl : selectedBalance.el).available)} days</strong></p>
                    <div className="lb-field">
                      <label htmlFor="balance-correction-available">Correct available days (0 allowed)</label>
                      <input id="balance-correction-available" type="number" min="0" step="0.5" required
                        value={correctionAvailable} disabled={saving}
                        onChange={(event) => setCorrectionAvailable(event.target.value)} placeholder="Enter final available balance" />
                    </div>
                    <div className="lb-field">
                      <label htmlFor="balance-correction-reason">Reason for correction</label>
                      <textarea id="balance-correction-reason" rows={3} maxLength={500} minLength={5} required
                        value={correctionReason} disabled={saving}
                        onChange={(event) => setCorrectionReason(event.target.value)} placeholder="Explain why this balance needs correction" />
                    </div>
                    <button type="submit" className="lb-primary-btn" disabled={saving || refreshing}>
                      {saving ? 'Saving correction...' : 'Set Balance'}
                    </button>
                    <LeaveBalanceInlineMessage message={feedbackMap['balance-correction']}
                      onClose={() => clearFeedback('balance-correction')} />
                  </form>
                ) : null}
              </div>
            </article>

            <article className="lb-card">
              {!selectedEmployeeId ? (
                <div className="lb-selected-empty">
                  <UserRound size={42} />
                  <strong>No employee selected</strong>
                  <span>
                    Select an employee to see the current leave balance.
                  </span>
                </div>
              ) : (
                <>
                  <div className="lb-person-head">
                    <EmployeeAvatar
                      employee={
                        selectedEmployee || selectedBalance.employee
                      }
                    />
                    <div>
                      <strong>{selectedBalance.employee_name}</strong>
                      <span>
                        {selectedBalance.employee_code ||
                          'No employee ID'}
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
                      <strong>
                        {formatLeaveDays(
                          selectedBalance.cl.available,
                        )}
                      </strong>
                      <div className="lb-balance-meta">
                        <div>
                          <span>Opening</span>
                          <b>
                            {formatLeaveDays(
                              selectedBalance.cl.opening_balance,
                            )}
                          </b>
                        </div>
                        <div>
                          <span>Credited</span>
                          <b>
                            {formatLeaveDays(
                              selectedBalance.cl.credited,
                            )}
                          </b>
                        </div>
                        <div>
                          <span>Used</span>
                          <b>
                            {formatLeaveDays(
                              selectedBalance.cl.used,
                            )}
                          </b>
                        </div>
                      </div>
                    </div>

                    <div className="lb-balance-box">
                      <span>Earned Leave Available</span>
                      <strong>
                        {formatLeaveDays(
                          selectedBalance.el.available,
                        )}
                      </strong>
                      <div className="lb-balance-meta">
                        <div>
                          <span>Opening</span>
                          <b>
                            {formatLeaveDays(
                              selectedBalance.el.opening_balance,
                            )}
                          </b>
                        </div>
                        <div>
                          <span>Credited</span>
                          <b>
                            {formatLeaveDays(
                              selectedBalance.el.credited,
                            )}
                          </b>
                        </div>
                        <div>
                          <span>Used</span>
                          <b>
                            {formatLeaveDays(
                              selectedBalance.el.used,
                            )}
                          </b>
                        </div>
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
                <span className="lb-section-kicker">
                  Balance Directory
                </span>
                <h2>Employee Leave Balances</h2>
                <p>
                  View the latest Casual Leave and Earned Leave for every
                  active employee.
                </p>
              </div>

              <div className="lb-table-tools">
                <label className="lb-search-box">
                  <Search size={16} />
                  <input
                    value={tableQuery}
                    onChange={(event) =>
                      setTableQuery(event.target.value)
                    }
                    placeholder="Search balances..."
                  />
                </label>

                <div className="lb-refresh-stack">
                  <button
                    type="button"
                    className="lb-soft-btn"
                    onClick={() =>
                      loadData({
                        showLoader: false,
                        feedbackScope: 'refresh',
                      })
                    }
                    disabled={loading || saving || refreshing}
                  >
                    {refreshing ? (
                      <Loader2 size={15} className="lb-spin" />
                    ) : (
                      <RefreshCcw size={15} />
                    )}
                    {refreshing ? 'Refreshing...' : 'Refresh'}
                  </button>

                  <LeaveBalanceInlineMessage
                    message={feedbackMap.refresh}
                    onClose={() => clearFeedback('refresh')}
                  />
                </div>
              </div>
            </div>

            <div className="lb-report-filters" aria-label="Leave balance filters">
              <label><span>Department</span><select value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)}>
                <option value="">All departments</option>{departmentOptions.map((d) => <option key={d} value={d}>{d}</option>)}
              </select></label>
              <label><span>Leave Type</span><select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="ALL">Casual + Earned</option><option value="CL">Casual Leave (CL)</option><option value="EL">Earned Leave (EL)</option>
              </select></label>
              <label><span>Available Balance</span><select value={balanceFilter} onChange={(e) => setBalanceFilter(e.target.value)}>
                <option value="all">All balances</option><option value="zero">Zero</option><option value="positive">Above zero</option><option value="negative">Below zero</option>
              </select></label>
              <div style={{ display: 'flex', alignItems: 'end' }}><button className="lb-soft-btn" type="button" onClick={() => { setTableQuery(''); setDepartmentFilter(''); setTypeFilter('ALL'); setBalanceFilter('all'); }}><Filter size={15} /> Clear filters</button></div>
            </div>
            <div className="lb-report-export">
              <label><span>Excel report</span><select value={exportPeriod} onChange={(e) => setExportPeriod(e.target.value)}>
                <option value="current">Current balances</option><option value="weekly">Weekly activity + balances</option><option value="monthly">Monthly activity + balances</option><option value="custom">Custom period</option>
              </select></label>
              {(exportPeriod === 'weekly' || exportPeriod === 'monthly') && <label><span>Week / month containing</span><input type="date" value={exportDate} onChange={(e) => setExportDate(e.target.value)} /></label>}
              {exportPeriod === 'custom' && <>
                <label><span>From</span><input type="date" value={exportFrom} onChange={(e) => setExportFrom(e.target.value)} /></label>
                <label><span>To</span><input type="date" value={exportTo} min={exportFrom || undefined} onChange={(e) => setExportTo(e.target.value)} /></label>
              </>}
              <button className="lb-primary-btn" type="button" onClick={downloadBalanceReport} disabled={exporting || loading}>
                {exporting ? <Loader2 size={16} className="lb-spin" /> : <Download size={16} />}
                {exporting ? 'Exporting...' : 'Export Excel'}
              </button>
            </div>
            <p className="lb-report-note">Excel includes employee names and filtered current leave balances. Weekly, monthly and custom reports also include leave requests overlapping the period. Current balances are not represented as historical balances.</p>
            <LeaveBalanceInlineMessage message={feedbackMap.export} onClose={() => clearFeedback('export')} />

            <LeaveBalancePageSize
              total={visibleRows.length}
              pageSize={pageSize}
              onPageSizeChange={(value) => {
                setPage(1);
                setPageSize(value);
              }}
            />

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
                  {pagedRows.map((row) => (
                    <tr key={row.employee_id}>
                      <td>
                        <div className="lb-name-cell">
                          <EmployeeAvatar
                            employee={row.employee}
                            size="sm"
                          />
                          <div>
                            <strong>{row.employee_name}</strong>
                          </div>
                        </div>
                      </td>
                      <td>{row.department || '—'}</td>
                      <td>
                        <span className="lb-number-pill">
                          {formatLeaveDays(row.cl.available)}
                        </span>
                      </td>
                      <td>{formatLeaveDays(row.cl.used)}</td>
                      <td>
                        <span className="lb-number-pill is-earned">
                          {formatLeaveDays(row.el.available)}
                        </span>
                      </td>
                      <td>{formatLeaveDays(row.el.used)}</td>
                      <td>
                        <div className="lb-row-action-stack">
                          <button
                            type="button"
                            className="lb-soft-btn"
                            onClick={() => {
                              selectEmployee(row.employee_id, {
                                showSelectionFeedback: true,
                                feedbackScope: `row-${row.employee_id}`,
                              });

                              document
                                .getElementById('leave-allocation')
                                ?.scrollIntoView({
                                  behavior: 'smooth',
                                  block: 'start',
                                });
                            }}
                            disabled={saving}
                          >
                            Add Leave
                          </button>
                          <button
                            type="button"
                            className="lb-soft-btn"
                            disabled={saving}
                            onClick={() => {
                              selectEmployee(row.employee_id);
                              setShowBalanceCorrection(true);
                              setCorrectionAvailable('');
                              setCorrectionReason('');
                              document.getElementById('leave-allocation')?.scrollIntoView({
                                behavior: 'smooth', block: 'start',
                              });
                            }}
                          >
                            Edit Balance
                          </button>

                          <LeaveBalanceInlineMessage
                            message={
                              feedbackMap[`row-${row.employee_id}`]
                            }
                            onClose={() =>
                              clearFeedback(`row-${row.employee_id}`)
                            }
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <LeaveBalancePagination
              total={visibleRows.length}
              page={safePage}
              pageSize={pageSize}
              onPageChange={setPage}
            />

            {!visibleRows.length ? (
              <div className="lb-empty">
                {loading
                  ? 'Loading leave balances...'
                  : 'No employee leave balances found.'}
              </div>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
