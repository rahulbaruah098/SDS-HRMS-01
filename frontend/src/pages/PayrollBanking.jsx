import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  Ban,
  Banknote,
  Clock3,
  Download,
  FileCheck2,
  FileSpreadsheet,
  Fingerprint,
  History,
  KeyRound,
  Landmark,
  Loader2,
  LockKeyhole,
  Pencil,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  ShieldX,
  UserRound,
  UsersRound,
  WalletCards,
} from 'lucide-react';

import { api, getApiUrl, getToken } from '../api/client';
import { useCustomAlert } from '../components/CustomAlertProvider.jsx';

const DEFAULT_LIMIT = 500;

const BANK_ACCOUNT_TYPES = [
  ['salary', 'Salary'],
  ['savings', 'Savings'],
  ['current', 'Current'],
  ['overdraft', 'Overdraft'],
  ['nre', 'NRE'],
  ['nro', 'NRO'],
];

const PAYMENT_METHODS = [
  ['neft', 'NEFT'],
  ['rtgs', 'RTGS'],
  ['imps', 'IMPS'],
  ['bank_transfer', 'Bank Transfer'],
];

const VERIFICATION_FILTERS = [
  ['', 'All verification statuses'],
  ['pending_verification', 'Pending Verification'],
  ['verified', 'Verified'],
  ['rejected', 'Rejected'],
];

const EXPORT_STATUS_OPTIONS = [
  ['generated', 'Generated'],
  ['uploaded', 'Uploaded'],
  ['accepted', 'Accepted'],
  ['rejected', 'Rejected'],
  ['processed', 'Processed'],
];

const MANAGEMENT_ROLES = new Set([
  'super_admin',
  'admin',
  'hr_admin',
  'hr_manager',
  'hr',
  'finance',
  'accounts_finance',
]);

const FINANCE_ACTION_ROLES = new Set([
  'super_admin',
  'admin',
  'finance',
  'accounts_finance',
]);

const EXPORTABLE_RUN_STATUSES = new Set(['locked', 'disbursed']);
const SNAPSHOT_READY_RUN_STATUSES = new Set([
  'finance_approved',
  'locked',
  'disbursed',
]);

function safeText(value, fallback = '—') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function normalizeKey(value) {
  return safeText(value, '')
    .toLowerCase()
    .replaceAll('-', '_')
    .replace(/\s+/g, '_');
}

function normalizeRoles(user = {}) {
  const rawRoles = Array.isArray(user.roles)
    ? user.roles
    : typeof user.roles === 'string'
      ? user.roles.split(',')
      : [];

  const roles = rawRoles.map(normalizeKey).filter(Boolean);
  const role = normalizeKey(user.role);

  if (role && !roles.includes(role)) {
    roles.push(role);
  }

  return roles;
}

function hasAnyRole(user, roleSet) {
  return normalizeRoles(user).some((role) => roleSet.has(role));
}

function isSuperAdmin(user) {
  return normalizeRoles(user).includes('super_admin');
}

function buildQuery(params = {}) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item !== undefined && item !== null && item !== '') {
          query.append(key, item);
        }
      });
      return;
    }

    query.append(key, value);
  });

  const queryString = query.toString();
  return queryString ? `?${queryString}` : '';
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(toNumber(value, 0));
}

function formatDate(value, includeTime = true) {
  if (!value) {
    return '—';
  }

  const rawValue = typeof value === 'object' && value.$date ? value.$date : value;
  const parsed = new Date(rawValue);

  if (Number.isNaN(parsed.getTime())) {
    return safeText(rawValue);
  }

  return parsed.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(includeTime
      ? {
          hour: '2-digit',
          minute: '2-digit',
        }
      : {}),
  });
}

function labelFromKey(value) {
  return safeText(value, '—')
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function recordId(record = {}) {
  return safeText(record._id || record.id, '');
}

function employeeId(employee = {}) {
  return safeText(employee._id || employee.id || employee.employee_id, '');
}

function employeeName(employee = {}) {
  return safeText(
    employee.employee_name ||
      employee.name ||
      employee.full_name ||
      employee.display_name ||
      employee.official_email,
    'Employee',
  );
}

function employeeCode(employee = {}) {
  return safeText(
    employee.employee_code ||
      employee.emp_code ||
      employee.employee_id ||
      employee.code,
    '—',
  );
}

function employeeEmail(employee = {}) {
  return safeText(
    employee.official_email ||
      employee.email ||
      employee.work_email,
    '—',
  );
}

function sortEmployees(items = []) {
  return [...items].sort((left, right) =>
    employeeName(left).localeCompare(employeeName(right), 'en', {
      sensitivity: 'base',
    }),
  );
}

function verificationTone(value) {
  const status = normalizeKey(value);

  if (status === 'verified') {
    return 'success';
  }

  if (status === 'rejected') {
    return 'danger';
  }

  return 'warning';
}

function runTone(value) {
  const status = normalizeKey(value);

  if (status === 'disbursed') {
    return 'success';
  }

  if (status === 'locked') {
    return 'info';
  }

  if (status === 'finance_approved') {
    return 'warning';
  }

  return 'neutral';
}

function exportTone(value) {
  const status = normalizeKey(value);

  if (['accepted', 'processed'].includes(status)) {
    return 'success';
  }

  if (status === 'rejected') {
    return 'danger';
  }

  if (status === 'uploaded') {
    return 'info';
  }

  return 'warning';
}

function emptyBankForm() {
  return {
    employee_id: '',
    account_holder_name: '',
    account_number: '',
    ifsc_code: '',
    bank_name: '',
    branch_name: '',
    account_type: 'salary',
    payment_method: 'neft',
    beneficiary_code: '',
    effective_from: '',
    note: '',
  };
}

function emptyDecisionForm() {
  return {
    decision: 'verified',
    note: '',
  };
}

function emptyExportForm() {
  return {
    export_format: 'generic_neft_csv',
    export_version: '1',
    narration_prefix: 'Salary',
    delimiter: ',',
    include_utf8_bom: true,
  };
}

function emptyExportStatusForm() {
  return {
    status: 'uploaded',
    reference: '',
    note: '',
  };
}

function runIdentifier(run = {}) {
  return safeText(run._id || run.id || run.run_id, '');
}

function periodLabel(run = {}) {
  return safeText(
    run.period_key ||
      run.period ||
      run.payroll_period ||
      run.month,
    '—',
  );
}

function runEmployeeCount(run = {}) {
  return toNumber(
    run.employee_count ||
      run.total_employees ||
      run.payslip_count ||
      run.summary?.employee_count,
    0,
  );
}

function runAmount(run = {}) {
  return toNumber(
    run.total_net_pay ||
      run.net_payable ||
      run.net_salary_total ||
      run.summary?.total_net_pay ||
      run.summary?.net_payable,
    0,
  );
}

function getCurrentEmployeeReference(user = {}) {
  return safeText(
    user.employee_id ||
      user.employee?._id ||
      user.employee?.id ||
      user.employee?.employee_id ||
      user.employee_code ||
      user.employee?.employee_code,
    '',
  );
}

function maskDisplay(record = {}) {
  return safeText(
    record.masked_account_number ||
      (record.account_number_last4
        ? `••••••${record.account_number_last4}`
        : ''),
    'Not available',
  );
}

function parseDownloadFilename(response, fallback) {
  const disposition = response.headers.get('content-disposition') || '';
  const utfFilename = disposition.match(/filename\*=UTF-8''([^;]+)/i);

  if (utfFilename?.[1]) {
    return decodeURIComponent(utfFilename[1].replace(/["']/g, ''));
  }

  const filename = disposition.match(/filename="?([^"]+)"?/i);
  return filename?.[1]?.trim() || fallback;
}

async function parseFailedDownload(response) {
  const contentType = response.headers.get('content-type') || '';

  try {
    if (contentType.includes('application/json')) {
      const data = await response.json();
      return (
        data.message ||
        data.error?.message ||
        data.error ||
        `Request failed with status ${response.status}.`
      );
    }

    const text = await response.text();
    return text || `Request failed with status ${response.status}.`;
  } catch {
    return `Request failed with status ${response.status}.`;
  }
}

export default function PayrollBanking({ user = {} }) {
  const alerts = useCustomAlert();
  const superAdmin = isSuperAdmin(user);
  const canManage = hasAnyRole(user, MANAGEMENT_ROLES);
  const canFinanceAct = hasAnyRole(user, FINANCE_ACTION_ROLES);
  const ownEmployeeReference = getCurrentEmployeeReference(user);

  const [activeTab, setActiveTab] = useState('bank_details');
  const [tenantId, setTenantId] = useState(
    safeText(user.tenant_id || user.tenant?.tenant_id || user.tenant?.code, ''),
  );

  const [employees, setEmployees] = useState([]);
  const [bankRecords, setBankRecords] = useState([]);
  const [payrollRuns, setPayrollRuns] = useState([]);
  const [bankExports, setBankExports] = useState([]);

  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [selectedBankRecord, setSelectedBankRecord] = useState(null);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [selectedExport, setSelectedExport] = useState(null);

  const [search, setSearch] = useState('');
  const [verificationFilter, setVerificationFilter] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [periodFilter, setPeriodFilter] = useState('');
  const [exportStatusFilter, setExportStatusFilter] = useState('');

  const [loadingBanks, setLoadingBanks] = useState(false);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingExports, setLoadingExports] = useState(false);
  const [savingBank, setSavingBank] = useState(false);
  const [actionLoading, setActionLoading] = useState('');

  const [showBankForm, setShowBankForm] = useState(false);
  const [bankFormMode, setBankFormMode] = useState('create');
  const [bankForm, setBankForm] = useState(emptyBankForm());

  const [showDecisionModal, setShowDecisionModal] = useState(false);
  const [decisionRecord, setDecisionRecord] = useState(null);
  const [decisionForm, setDecisionForm] = useState(emptyDecisionForm());

  const [showDeactivateModal, setShowDeactivateModal] = useState(false);
  const [deactivateRecord, setDeactivateRecord] = useState(null);
  const [deactivateReason, setDeactivateReason] = useState('');

  const [showExportModal, setShowExportModal] = useState(false);
  const [exportRun, setExportRun] = useState(null);
  const [exportForm, setExportForm] = useState(emptyExportForm());

  const [showExportStatusModal, setShowExportStatusModal] = useState(false);
  const [exportStatusForm, setExportStatusForm] = useState(
    emptyExportStatusForm(),
  );

  const recordsByEmployee = useMemo(() => {
    const map = new Map();

    bankRecords.forEach((record) => {
      const key = safeText(record.employee_id, '');

      if (key) {
        map.set(key, record);
      }
    });

    return map;
  }, [bankRecords]);

  const bankRows = useMemo(() => {
    if (!canManage) {
      return bankRecords;
    }

    if (!employees.length) {
      return bankRecords;
    }

    return employees.map((employee) => {
      const id = employeeId(employee);
      const record = recordsByEmployee.get(id);

      if (record) {
        return {
          ...record,
          employee_id: id,
          employee_code: safeText(
            record.employee_code,
            employeeCode(employee),
          ),
          employee_name: safeText(
            record.employee_name,
            employeeName(employee),
          ),
          employee_email: employeeEmail(employee),
          has_bank_details: true,
        };
      }

      return {
        employee_id: id,
        employee_code: employeeCode(employee),
        employee_name: employeeName(employee),
        employee_email: employeeEmail(employee),
        verification_status: 'not_added',
        status: 'not_added',
        is_active: true,
        has_bank_details: false,
      };
    });
  }, [bankRecords, canManage, employees, recordsByEmployee]);

  const filteredBankRows = useMemo(() => {
    const term = normalizeKey(search);

    return bankRows.filter((record) => {
      const verificationStatus = normalizeKey(record.verification_status);

      if (
        verificationFilter &&
        verificationStatus !== normalizeKey(verificationFilter)
      ) {
        return false;
      }

      if (!includeInactive && record.is_active === false) {
        return false;
      }

      if (!term) {
        return true;
      }

      const haystack = [
        record.employee_name,
        record.employee_code,
        record.employee_email,
        record.account_holder_name,
        record.masked_account_number,
        record.ifsc_code,
        record.bank_name,
        record.branch_name,
        record.account_type,
        record.payment_method,
        record.verification_status,
      ]
        .map(normalizeKey)
        .join(' ');

      return haystack.includes(term);
    });
  }, [
    bankRows,
    includeInactive,
    search,
    verificationFilter,
  ]);

  const filteredRuns = useMemo(() => {
    return payrollRuns.filter((run) => {
      if (
        periodFilter &&
        periodLabel(run) !== periodFilter
      ) {
        return false;
      }

      return SNAPSHOT_READY_RUN_STATUSES.has(normalizeKey(run.status));
    });
  }, [payrollRuns, periodFilter]);

  const filteredExports = useMemo(() => {
    return bankExports.filter((record) => {
      if (
        exportStatusFilter &&
        normalizeKey(record.status) !== normalizeKey(exportStatusFilter)
      ) {
        return false;
      }

      if (periodFilter && safeText(record.period_key, '') !== periodFilter) {
        return false;
      }

      return true;
    });
  }, [bankExports, exportStatusFilter, periodFilter]);

  const metrics = useMemo(() => {
    const actualRecords = bankRows.filter(
      (record) => record.has_bank_details !== false,
    );
    const verified = actualRecords.filter(
      (record) => normalizeKey(record.verification_status) === 'verified',
    ).length;
    const pending = actualRecords.filter(
      (record) =>
        normalizeKey(record.verification_status) === 'pending_verification',
    ).length;
    const rejected = actualRecords.filter(
      (record) => normalizeKey(record.verification_status) === 'rejected',
    ).length;
    const missing = bankRows.filter(
      (record) => record.has_bank_details === false,
    ).length;

    return {
      employees: bankRows.length,
      verified,
      pending,
      rejected,
      missing,
    };
  }, [bankRows]);

  function tenantParams() {
    if (!superAdmin || !tenantId.trim()) {
      return {};
    }

    return { tenant_id: tenantId.trim() };
  }

  function assertTenant() {
    if (superAdmin && !tenantId.trim()) {
      alerts.warning(
        'Enter the company tenant ID before loading or changing payroll banking data.',
        'Tenant Required',
      );
      return false;
    }

    return true;
  }

  async function loadEmployees({ silent = false } = {}) {
    if (!canManage) {
      setEmployees([]);
      return [];
    }

    if (!assertTenant()) {
      setEmployees([]);
      return [];
    }

    try {
      setLoadingEmployees(true);

      const data = await api(
        `/employees${buildQuery({
          ...tenantParams(),
          limit: DEFAULT_LIMIT,
          sort_by: 'name',
          sort_dir: 'asc',
        })}`,
      );
      const rows = sortEmployees(data.items || []);

      setEmployees(rows);

      if (!selectedEmployeeId && rows.length) {
        setSelectedEmployeeId(employeeId(rows[0]));
      }

      return rows;
    } catch (error) {
      setEmployees([]);

      if (!silent) {
        alerts.error(
          error.message || 'Unable to load employees.',
          'Employee Load Failed',
        );
      }

      return [];
    } finally {
      setLoadingEmployees(false);
    }
  }

  async function loadBankDetails({
    silent = false,
    preferredEmployeeId = '',
  } = {}) {
    if (!assertTenant()) {
      setBankRecords([]);
      setSelectedBankRecord(null);
      return [];
    }

    try {
      setLoadingBanks(true);

      const data = await api(
        `/payroll/bank-details${buildQuery({
          ...tenantParams(),
          verification_status: verificationFilter,
          include_inactive: canManage && includeInactive ? 'true' : '',
          include_history: canFinanceAct ? 'true' : '',
          limit: DEFAULT_LIMIT,
        })}`,
      );
      const rows = Array.isArray(data.items) ? data.items : [];

      setBankRecords(rows);

      const desiredEmployeeId =
        preferredEmployeeId ||
        selectedEmployeeId ||
        ownEmployeeReference ||
        safeText(selectedBankRecord?.employee_id, '');

      if (desiredEmployeeId) {
        const selected = rows.find(
          (record) => safeText(record.employee_id, '') === desiredEmployeeId,
        );

        setSelectedBankRecord(selected || null);
      }

      return rows;
    } catch (error) {
      setBankRecords([]);
      setSelectedBankRecord(null);

      if (!silent) {
        alerts.error(
          error.message || 'Unable to load bank details.',
          'Bank Details Load Failed',
        );
      }

      return [];
    } finally {
      setLoadingBanks(false);
    }
  }

  async function loadPayrollRuns({ silent = false } = {}) {
    if (!canFinanceAct || !assertTenant()) {
      setPayrollRuns([]);
      return [];
    }

    try {
      setLoadingRuns(true);

      const data = await api(
        `/payroll_runs${buildQuery({
          ...tenantParams(),
          limit: 300,
          sort_by: 'period_key',
          sort_dir: 'desc',
        })}`,
      );
      const rows = Array.isArray(data.items) ? data.items : [];

      setPayrollRuns(rows);

      if (!selectedRunId) {
        const firstEligible = rows.find((run) =>
          SNAPSHOT_READY_RUN_STATUSES.has(normalizeKey(run.status)),
        );

        if (firstEligible) {
          setSelectedRunId(runIdentifier(firstEligible));
        }
      }

      return rows;
    } catch (error) {
      setPayrollRuns([]);

      if (!silent) {
        alerts.error(
          error.message || 'Unable to load payroll runs.',
          'Payroll Run Load Failed',
        );
      }

      return [];
    } finally {
      setLoadingRuns(false);
    }
  }

  async function loadBankExports({ silent = false } = {}) {
    if (!canFinanceAct || !assertTenant()) {
      setBankExports([]);
      return [];
    }

    try {
      setLoadingExports(true);

      const data = await api(
        `/payroll/bank-exports${buildQuery({
          ...tenantParams(),
          period: periodFilter,
          status: exportStatusFilter,
          limit: 300,
        })}`,
      );
      const rows = Array.isArray(data.items) ? data.items : [];

      setBankExports(rows);

      if (selectedExport) {
        const updated = rows.find(
          (record) => recordId(record) === recordId(selectedExport),
        );
        setSelectedExport(updated || null);
      }

      return rows;
    } catch (error) {
      setBankExports([]);

      if (!silent) {
        alerts.error(
          error.message || 'Unable to load bank export history.',
          'Bank Export Load Failed',
        );
      }

      return [];
    } finally {
      setLoadingExports(false);
    }
  }

  async function refreshAll({ silent = false } = {}) {
    const tasks = [
      loadBankDetails({ silent }),
    ];

    if (canManage) {
      tasks.push(loadEmployees({ silent: true }));
    }

    if (canFinanceAct) {
      tasks.push(loadPayrollRuns({ silent: true }));
      tasks.push(loadBankExports({ silent: true }));
    }

    await Promise.all(tasks);
  }

  useEffect(() => {
    if (superAdmin && !tenantId.trim()) {
      setEmployees([]);
      setBankRecords([]);
      setPayrollRuns([]);
      setBankExports([]);
      setSelectedBankRecord(null);
      return;
    }

    refreshAll({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  useEffect(() => {
    if (superAdmin && !tenantId.trim()) {
      return;
    }

    loadBankDetails({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verificationFilter, includeInactive]);

  useEffect(() => {
    if (!canFinanceAct || (superAdmin && !tenantId.trim())) {
      return;
    }

    loadBankExports({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodFilter, exportStatusFilter]);

  function employeeForId(id) {
    return employees.find((employee) => employeeId(employee) === id) || null;
  }

  function openCreateBank(employee = null) {
    if (!assertTenant()) {
      return;
    }

    const selectedEmployee = employee || employeeForId(selectedEmployeeId);
    const reference = canManage
      ? employeeId(selectedEmployee || {})
      : ownEmployeeReference;

    setBankFormMode('create');
    setBankForm({
      ...emptyBankForm(),
      employee_id: reference,
      account_holder_name: selectedEmployee
        ? employeeName(selectedEmployee)
        : safeText(
            user.employee_name ||
              user.name ||
              user.full_name,
            '',
          ),
      beneficiary_code: selectedEmployee
        ? employeeCode(selectedEmployee) === '—'
          ? ''
          : employeeCode(selectedEmployee)
        : safeText(user.employee_code, ''),
    });
    setShowBankForm(true);
  }

  function openEditBank(record) {
    setBankFormMode('edit');
    setBankForm({
      employee_id: safeText(record.employee_id, ''),
      account_holder_name: safeText(record.account_holder_name, ''),
      account_number: '',
      ifsc_code: safeText(record.ifsc_code, ''),
      bank_name: safeText(record.bank_name, ''),
      branch_name: safeText(record.branch_name, ''),
      account_type: normalizeKey(record.account_type) || 'salary',
      payment_method: normalizeKey(record.payment_method) || 'neft',
      beneficiary_code: safeText(record.beneficiary_code, ''),
      effective_from: safeText(record.effective_from, ''),
      note: '',
    });
    setSelectedBankRecord(record);
    setShowBankForm(true);
  }

  function closeBankForm() {
    if (savingBank) {
      return;
    }

    setShowBankForm(false);
    setBankFormMode('create');
    setBankForm(emptyBankForm());
  }

  function updateBankForm(field, value) {
    setBankForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function validateBankForm() {
    if (canManage && !bankForm.employee_id) {
      return 'Select an employee.';
    }

    if (!bankForm.account_holder_name.trim()) {
      return 'Enter the account holder name.';
    }

    if (bankFormMode === 'create' && !bankForm.account_number.trim()) {
      return 'Enter the complete bank account number.';
    }

    if (bankForm.account_number.trim()) {
      const normalized = bankForm.account_number
        .replace(/[\s-]+/g, '')
        .toUpperCase();

      if (!/^[A-Z0-9]{6,34}$/.test(normalized)) {
        return 'Account number must contain 6 to 34 letters or digits.';
      }
    }

    if (!/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(bankForm.ifsc_code.trim())) {
      return 'Enter a valid 11-character IFSC code.';
    }

    if (!bankForm.bank_name.trim()) {
      return 'Enter the bank name.';
    }

    if (!bankForm.beneficiary_code.trim()) {
      return 'Enter the beneficiary code.';
    }

    return '';
  }

  async function saveBankDetails(event) {
    event.preventDefault();

    const validationMessage = validateBankForm();

    if (validationMessage) {
      alerts.warning(validationMessage, 'Bank Details Required');
      return;
    }

    if (!assertTenant()) {
      return;
    }

    const employeeReference =
      bankForm.employee_id ||
      ownEmployeeReference ||
      safeText(selectedBankRecord?.employee_id, '');

    const payload = {
      ...tenantParams(),
      ...(canManage && employeeReference
        ? { employee_id: employeeReference }
        : {}),
      account_holder_name: bankForm.account_holder_name.trim(),
      ifsc_code: bankForm.ifsc_code.trim().toUpperCase(),
      bank_name: bankForm.bank_name.trim(),
      branch_name: bankForm.branch_name.trim(),
      account_type: bankForm.account_type,
      payment_method: bankForm.payment_method,
      beneficiary_code: bankForm.beneficiary_code.trim().toUpperCase(),
      effective_from: bankForm.effective_from,
      note: bankForm.note.trim(),
    };

    if (bankForm.account_number.trim()) {
      payload.account_number = bankForm.account_number
        .replace(/[\s-]+/g, '')
        .toUpperCase();
    }

    try {
      setSavingBank(true);

      const data = await api(
        bankFormMode === 'edit' && employeeReference
          ? `/payroll/bank-details/${encodeURIComponent(employeeReference)}`
          : '/payroll/bank-details',
        {
          method: bankFormMode === 'edit' ? 'PUT' : 'POST',
          body: JSON.stringify(payload),
        },
      );

      alerts.success(
        data.message ||
          'Bank details saved and sent for verification.',
        'Bank Details Saved',
      );

      closeBankForm();
      setSelectedEmployeeId(employeeReference);
      await loadBankDetails({
        silent: true,
        preferredEmployeeId: employeeReference,
      });
    } catch (error) {
      alerts.error(
        error.message || 'Unable to save bank details.',
        'Bank Details Save Failed',
      );
    } finally {
      setSavingBank(false);
    }
  }

  function openDecision(record, decision) {
    setDecisionRecord(record);
    setDecisionForm({
      decision,
      note: '',
    });
    setShowDecisionModal(true);
  }

  function closeDecisionModal() {
    if (actionLoading) {
      return;
    }

    setShowDecisionModal(false);
    setDecisionRecord(null);
    setDecisionForm(emptyDecisionForm());
  }

  async function saveVerificationDecision(event) {
    event.preventDefault();

    const employeeReference = safeText(decisionRecord?.employee_id, '');

    if (!employeeReference || !assertTenant()) {
      return;
    }

    if (
      decisionForm.decision === 'rejected' &&
      !decisionForm.note.trim()
    ) {
      alerts.warning(
        'Enter the rejection reason.',
        'Rejection Reason Required',
      );
      return;
    }

    const confirmed = await alerts.confirm(
      decisionForm.decision === 'verified'
        ? 'Verify this bank-detail revision for salary disbursement? Maker-checker controls will be enforced by the backend.'
        : 'Reject this bank-detail revision and return it for correction?',
      decisionForm.decision === 'verified'
        ? 'Verify Bank Details'
        : 'Reject Bank Details',
      {
        confirmText:
          decisionForm.decision === 'verified'
            ? 'Verify Details'
            : 'Reject Details',
        cancelText: 'Go Back',
        danger: decisionForm.decision === 'rejected',
      },
    );

    if (!confirmed) {
      return;
    }

    try {
      setActionLoading(`verify-${employeeReference}`);

      const data = await api(
        `/payroll/bank-details/${encodeURIComponent(
          employeeReference,
        )}/verify`,
        {
          method: 'POST',
          body: JSON.stringify({
            ...tenantParams(),
            decision: decisionForm.decision,
            note: decisionForm.note.trim(),
          }),
        },
      );

      alerts.success(
        data.message || 'Bank verification decision saved.',
        'Verification Updated',
      );
      closeDecisionModal();
      await loadBankDetails({
        silent: true,
        preferredEmployeeId: employeeReference,
      });
    } catch (error) {
      alerts.error(
        error.message || 'Unable to save the verification decision.',
        'Verification Failed',
      );
    } finally {
      setActionLoading('');
    }
  }

  function openDeactivate(record) {
    setDeactivateRecord(record);
    setDeactivateReason('');
    setShowDeactivateModal(true);
  }

  function closeDeactivateModal() {
    if (actionLoading) {
      return;
    }

    setShowDeactivateModal(false);
    setDeactivateRecord(null);
    setDeactivateReason('');
  }

  async function deactivateBankRecord(event) {
    event.preventDefault();

    const employeeReference = safeText(deactivateRecord?.employee_id, '');

    if (!employeeReference || !assertTenant()) {
      return;
    }

    if (!deactivateReason.trim()) {
      alerts.warning(
        'Enter a deactivation reason.',
        'Reason Required',
      );
      return;
    }

    const confirmed = await alerts.confirm(
      'Deactivate these bank details? They will no longer be available for payroll disbursement.',
      'Deactivate Bank Details',
      {
        confirmText: 'Deactivate',
        cancelText: 'Keep Active',
        danger: true,
      },
    );

    if (!confirmed) {
      return;
    }

    try {
      setActionLoading(`deactivate-${employeeReference}`);

      const data = await api(
        `/payroll/bank-details/${encodeURIComponent(
          employeeReference,
        )}/deactivate`,
        {
          method: 'POST',
          body: JSON.stringify({
            ...tenantParams(),
            reason: deactivateReason.trim(),
          }),
        },
      );

      alerts.success(
        data.message || 'Bank details deactivated.',
        'Bank Details Deactivated',
      );
      closeDeactivateModal();
      await loadBankDetails({
        silent: true,
        preferredEmployeeId: employeeReference,
      });
    } catch (error) {
      alerts.error(
        error.message || 'Unable to deactivate bank details.',
        'Deactivation Failed',
      );
    } finally {
      setActionLoading('');
    }
  }

  async function prepareSnapshots(run) {
    const id = runIdentifier(run);

    if (!id || !assertTenant()) {
      return;
    }

    const confirmed = await alerts.confirm(
      `Validate and snapshot verified employee bank details for payroll period ${periodLabel(
        run,
      )}?`,
      'Prepare Bank Snapshots',
      {
        confirmText: 'Prepare Snapshots',
        cancelText: 'Go Back',
      },
    );

    if (!confirmed) {
      return;
    }

    try {
      setActionLoading(`snapshot-${id}`);

      const data = await api(
        `/payroll/run/${encodeURIComponent(id)}/prepare-bank-snapshots`,
        {
          method: 'POST',
          body: JSON.stringify({
            ...tenantParams(),
            allow_partial: false,
          }),
        },
      );
      const result = data.bank_snapshot_validation || {};
      const totals = result.totals || {};

      alerts.success(
        `Prepared ${toNumber(totals.prepared)} bank snapshot(s), skipped ${toNumber(
          totals.skipped,
        )}, failed ${toNumber(totals.failed)}.`,
        'Bank Snapshots Prepared',
      );
      await loadPayrollRuns({ silent: true });
    } catch (error) {
      const details =
        error.details?.bank_snapshot_validation ||
        error.details ||
        {};
      const failed =
        details.totals?.failed ||
        details.failures?.length ||
        0;

      alerts.error(
        failed
          ? `${error.message || 'Bank snapshot validation failed.'} ${failed} employee record(s) require correction.`
          : error.message || 'Unable to prepare bank snapshots.',
        'Bank Snapshot Validation Failed',
      );
    } finally {
      setActionLoading('');
    }
  }

  function openExport(run) {
    setExportRun(run);
    setSelectedRunId(runIdentifier(run));
    setExportForm(emptyExportForm());
    setShowExportModal(true);
  }

  function closeExportModal() {
    if (actionLoading) {
      return;
    }

    setShowExportModal(false);
    setExportRun(null);
    setExportForm(emptyExportForm());
  }

  async function downloadBankFile(event) {
    event.preventDefault();

    const runId = runIdentifier(exportRun);

    if (!runId || !assertTenant()) {
      return;
    }

    const confirmed = await alerts.confirm(
      `Generate and download the salary bank CSV for payroll period ${periodLabel(
        exportRun,
      )}? The backend will validate every locked bank snapshot again.`,
      'Generate Salary Bank File',
      {
        confirmText: 'Generate CSV',
        cancelText: 'Go Back',
      },
    );

    if (!confirmed) {
      return;
    }

    try {
      setActionLoading(`export-${runId}`);

      const token = getToken();
      const response = await fetch(
        getApiUrl(`/payroll/run/${encodeURIComponent(runId)}/bank-file`),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            ...tenantParams(),
            export_format: exportForm.export_format.trim(),
            export_version: exportForm.export_version.trim(),
            narration_prefix: exportForm.narration_prefix.trim(),
            delimiter: exportForm.delimiter,
            include_utf8_bom: exportForm.include_utf8_bom,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(await parseFailedDownload(response));
      }

      const blob = await response.blob();
      const filename = parseDownloadFilename(
        response,
        `salary-disbursement-${periodLabel(exportRun)}.csv`,
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');

      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);

      const transactionCount =
        response.headers.get('x-payroll-transaction-count') || '0';
      const transactionAmount =
        response.headers.get('x-payroll-transaction-amount') || '0';

      alerts.success(
        `Downloaded ${transactionCount} salary transaction(s) totalling ${formatCurrency(
          transactionAmount,
        )}.`,
        'Salary Bank File Generated',
      );

      closeExportModal();
      await loadBankExports({ silent: true });
    } catch (error) {
      alerts.error(
        error.message || 'Unable to generate the salary bank file.',
        'Bank File Generation Failed',
      );
    } finally {
      setActionLoading('');
    }
  }

  function openExportStatus(record) {
    setSelectedExport(record);
    setExportStatusForm({
      status:
        normalizeKey(record.status) === 'generated'
          ? 'uploaded'
          : normalizeKey(record.status) || 'uploaded',
      reference: safeText(record.status_reference, ''),
      note: '',
    });
    setShowExportStatusModal(true);
  }

  function closeExportStatusModal() {
    if (actionLoading) {
      return;
    }

    setShowExportStatusModal(false);
    setSelectedExport(null);
    setExportStatusForm(emptyExportStatusForm());
  }

  async function saveExportStatus(event) {
    event.preventDefault();

    const id = recordId(selectedExport);

    if (!id || !assertTenant()) {
      return;
    }

    try {
      setActionLoading(`export-status-${id}`);

      const data = await api(
        `/payroll/bank-exports/${encodeURIComponent(id)}/status`,
        {
          method: 'POST',
          body: JSON.stringify({
            ...tenantParams(),
            status: exportStatusForm.status,
            reference: exportStatusForm.reference.trim(),
            note: exportStatusForm.note.trim(),
          }),
        },
      );

      alerts.success(
        data.message || 'Bank export status updated.',
        'Export Status Updated',
      );
      closeExportStatusModal();
      await loadBankExports({ silent: true });
    } catch (error) {
      alerts.error(
        error.message || 'Unable to update the bank export status.',
        'Export Status Update Failed',
      );
    } finally {
      setActionLoading('');
    }
  }

  function selectBankRow(record) {
    setSelectedEmployeeId(safeText(record.employee_id, ''));
    setSelectedBankRecord(
      record.has_bank_details === false ? null : record,
    );
  }

  function renderBankActions(record, compact = false) {
    const hasDetails = record.has_bank_details !== false;
    const status = normalizeKey(record.verification_status);
    const employeeReference = safeText(record.employee_id, '');

    return (
      <div className={`paybank-actions ${compact ? 'is-compact' : ''}`}>
        {!hasDetails ? (
          <button
            type="button"
            className="paybank-btn paybank-btn-primary"
            onClick={(event) => {
              event.stopPropagation();
              openCreateBank(employeeForId(employeeReference));
            }}
          >
            <Banknote size={15} />
            Add Bank Details
          </button>
        ) : (
          <button
            type="button"
            className="paybank-btn paybank-btn-secondary"
            onClick={(event) => {
              event.stopPropagation();
              openEditBank(record);
            }}
          >
            <Pencil size={15} />
            Update
          </button>
        )}

        {hasDetails &&
        status === 'pending_verification' &&
        canFinanceAct ? (
          <>
            <button
              type="button"
              className="paybank-btn paybank-btn-success"
              onClick={(event) => {
                event.stopPropagation();
                openDecision(record, 'verified');
              }}
            >
              <BadgeCheck size={15} />
              Verify
            </button>

            <button
              type="button"
              className="paybank-btn paybank-btn-danger"
              onClick={(event) => {
                event.stopPropagation();
                openDecision(record, 'rejected');
              }}
            >
              <ShieldX size={15} />
              Reject
            </button>
          </>
        ) : null}

        {hasDetails && record.is_active !== false && canFinanceAct ? (
          <button
            type="button"
            className="paybank-btn paybank-btn-ghost-danger"
            onClick={(event) => {
              event.stopPropagation();
              openDeactivate(record);
            }}
          >
            <Ban size={15} />
            Deactivate
          </button>
        ) : null}
      </div>
    );
  }

  const selectedEmployee = employeeForId(selectedEmployeeId);
  const selectedBank =
    selectedBankRecord ||
    recordsByEmployee.get(selectedEmployeeId) ||
    null;

  return (
    <div className="payroll-banking-page">
      <style>{`
        .payroll-banking-page {
          display: grid;
          gap: 18px;
          min-width: 0;
          color: var(--text, #172033);
        }

        .payroll-banking-page * {
          box-sizing: border-box;
        }

        .paybank-hero {
          position: relative;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 22px;
          overflow: hidden;
          padding: 25px;
          border: 1px solid rgba(43, 83, 205, 0.18);
          border-radius: 22px;
          background:
            radial-gradient(circle at 92% 12%, rgba(53, 95, 230, 0.16), transparent 35%),
            linear-gradient(135deg, rgba(247, 250, 255, 0.99), rgba(255, 255, 255, 0.99));
          box-shadow: 0 16px 42px rgba(15, 23, 42, 0.07);
        }

        .paybank-hero::after {
          position: absolute;
          right: -45px;
          bottom: -72px;
          width: 205px;
          height: 205px;
          border-radius: 50%;
          background: rgba(49, 88, 214, 0.07);
          content: '';
        }

        .paybank-hero-content,
        .paybank-hero-actions {
          position: relative;
          z-index: 1;
        }

        .paybank-kicker {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          margin-bottom: 8px;
          color: #3654c9;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .paybank-hero h1 {
          margin: 0 0 8px;
          font-size: clamp(25px, 3vw, 36px);
          line-height: 1.1;
        }

        .paybank-hero p {
          max-width: 820px;
          margin: 0;
          color: var(--muted, #64748b);
          line-height: 1.65;
        }

        .paybank-hero-actions {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 10px;
        }

        .paybank-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          min-height: 40px;
          padding: 9px 14px;
          border: 1px solid transparent;
          border-radius: 11px;
          font: inherit;
          font-size: 13px;
          font-weight: 850;
          line-height: 1;
          cursor: pointer;
          transition:
            transform 0.15s ease,
            border-color 0.15s ease,
            background 0.15s ease,
            opacity 0.15s ease;
        }

        .paybank-btn:hover:not(:disabled) {
          transform: translateY(-1px);
        }

        .paybank-btn:disabled {
          cursor: not-allowed;
          opacity: 0.55;
        }

        .paybank-btn-primary {
          color: #fff;
          background: #3654c9;
          border-color: #3654c9;
        }

        .paybank-btn-success {
          color: #fff;
          background: #07875f;
          border-color: #07875f;
        }

        .paybank-btn-danger {
          color: #fff;
          background: #c9364b;
          border-color: #c9364b;
        }

        .paybank-btn-secondary {
          color: #27324a;
          background: #fff;
          border-color: var(--border, #dfe5ee);
        }

        .paybank-btn-ghost-danger {
          color: #b4233a;
          background: rgba(201, 54, 75, 0.06);
          border-color: rgba(201, 54, 75, 0.18);
        }

        .paybank-tabs {
          display: flex;
          gap: 8px;
          overflow-x: auto;
          padding: 6px;
          border: 1px solid var(--border, #dfe5ee);
          border-radius: 15px;
          background: var(--card, #fff);
        }

        .paybank-tab {
          display: inline-flex;
          flex: 0 0 auto;
          align-items: center;
          justify-content: center;
          gap: 7px;
          min-height: 42px;
          padding: 9px 15px;
          border: 0;
          border-radius: 10px;
          background: transparent;
          color: #536078;
          font: inherit;
          font-size: 13px;
          font-weight: 850;
          cursor: pointer;
        }

        .paybank-tab.is-active {
          color: #fff;
          background: #3654c9;
        }

        .paybank-metrics {
          display: grid;
          grid-template-columns: repeat(5, minmax(145px, 1fr));
          gap: 13px;
        }

        .paybank-metric {
          min-width: 0;
          padding: 17px;
          border: 1px solid var(--border, #dfe5ee);
          border-radius: 16px;
          background: var(--card, #fff);
          box-shadow: 0 10px 28px rgba(15, 23, 42, 0.05);
        }

        .paybank-metric-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 10px;
          color: var(--muted, #64748b);
          font-size: 11px;
          font-weight: 900;
          text-transform: uppercase;
        }

        .paybank-metric strong {
          display: block;
          overflow: hidden;
          font-size: clamp(22px, 2.5vw, 30px);
          line-height: 1.15;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .paybank-panel {
          min-width: 0;
          padding: 20px;
          border: 1px solid var(--border, #dfe5ee);
          border-radius: 18px;
          background: var(--card, #fff);
          box-shadow: 0 12px 32px rgba(15, 23, 42, 0.055);
        }

        .paybank-toolbar {
          display: grid;
          grid-template-columns: minmax(240px, 1.4fr) repeat(3, minmax(160px, 0.7fr));
          gap: 12px;
          align-items: end;
        }

        .paybank-field {
          display: grid;
          gap: 7px;
          min-width: 0;
        }

        .paybank-field label {
          color: #465269;
          font-size: 12px;
          font-weight: 850;
        }

        .paybank-field input,
        .paybank-field select,
        .paybank-field textarea {
          width: 100%;
          min-width: 0;
          min-height: 42px;
          padding: 10px 12px;
          border: 1px solid var(--border, #d7dee9);
          border-radius: 11px;
          outline: none;
          background: var(--card, #fff);
          color: inherit;
          font: inherit;
          font-size: 14px;
        }

        .paybank-field textarea {
          min-height: 92px;
          resize: vertical;
          line-height: 1.5;
        }

        .paybank-field input:focus,
        .paybank-field select:focus,
        .paybank-field textarea:focus {
          border-color: #4f66d5;
          box-shadow: 0 0 0 3px rgba(54, 84, 201, 0.11);
        }

        .paybank-search-wrap {
          position: relative;
        }

        .paybank-search-wrap svg {
          position: absolute;
          top: 50%;
          left: 12px;
          color: #8a96aa;
          transform: translateY(-50%);
          pointer-events: none;
        }

        .paybank-search-wrap input {
          padding-left: 38px;
        }

        .paybank-checkbox {
          display: flex;
          align-items: center;
          gap: 8px;
          min-height: 42px;
          color: #465269;
          font-size: 13px;
          font-weight: 750;
        }

        .paybank-checkbox input {
          width: 17px;
          height: 17px;
        }

        .paybank-main-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.35fr) minmax(330px, 0.65fr);
          gap: 18px;
          align-items: start;
        }

        .paybank-section-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          margin-bottom: 16px;
        }

        .paybank-section-head h2,
        .paybank-section-head h3 {
          margin: 0 0 5px;
          font-size: 19px;
        }

        .paybank-section-head p {
          margin: 0;
          color: var(--muted, #64748b);
          font-size: 13px;
          line-height: 1.5;
        }

        .paybank-list {
          display: grid;
          gap: 11px;
        }

        .paybank-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 14px;
          padding: 15px;
          border: 1px solid var(--border, #dfe5ee);
          border-radius: 15px;
          background: #fff;
          cursor: pointer;
          transition:
            border-color 0.15s ease,
            box-shadow 0.15s ease,
            transform 0.15s ease;
        }

        .paybank-row:hover {
          border-color: rgba(54, 84, 201, 0.45);
          box-shadow: 0 10px 26px rgba(35, 48, 80, 0.08);
          transform: translateY(-1px);
        }

        .paybank-row.is-selected {
          border-color: #3654c9;
          box-shadow: 0 0 0 3px rgba(54, 84, 201, 0.1);
        }

        .paybank-row-title {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
          margin-bottom: 7px;
        }

        .paybank-row-title strong {
          min-width: 0;
          font-size: 15px;
        }

        .paybank-row-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 7px 14px;
          color: var(--muted, #64748b);
          font-size: 12px;
        }

        .paybank-row-meta span {
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }

        .paybank-row-end {
          min-width: 145px;
          text-align: right;
        }

        .paybank-row-end strong {
          display: block;
          margin-bottom: 4px;
          font-size: 15px;
        }

        .paybank-row-end small {
          color: var(--muted, #64748b);
          font-size: 11px;
        }

        .paybank-status {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 5px 9px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 900;
          white-space: nowrap;
        }

        .paybank-status-success {
          color: #047857;
          background: rgba(5, 150, 105, 0.1);
        }

        .paybank-status-info {
          color: #1d4ed8;
          background: rgba(37, 99, 235, 0.1);
        }

        .paybank-status-danger {
          color: #b4233a;
          background: rgba(201, 54, 75, 0.1);
        }

        .paybank-status-warning {
          color: #9a5b00;
          background: rgba(245, 158, 11, 0.13);
        }

        .paybank-status-neutral {
          color: #475569;
          background: rgba(100, 116, 139, 0.12);
        }

        .paybank-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 15px;
        }

        .paybank-actions.is-compact {
          justify-content: flex-end;
          margin-top: 10px;
        }

        .paybank-actions.is-compact .paybank-btn {
          min-height: 34px;
          padding: 7px 10px;
          font-size: 12px;
        }

        .paybank-detail {
          position: sticky;
          top: 18px;
          min-width: 0;
        }

        .paybank-detail-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          padding-bottom: 15px;
          border-bottom: 1px solid var(--border, #e3e7ef);
        }

        .paybank-detail-head h2 {
          margin: 0 0 5px;
          font-size: 20px;
        }

        .paybank-detail-head p {
          margin: 0;
          color: var(--muted, #64748b);
          font-size: 13px;
        }

        .paybank-detail-stats {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin: 15px 0;
        }

        .paybank-detail-stat {
          min-width: 0;
          padding: 12px;
          border-radius: 12px;
          background: rgba(148, 163, 184, 0.09);
        }

        .paybank-detail-stat span {
          display: block;
          margin-bottom: 4px;
          color: var(--muted, #64748b);
          font-size: 11px;
          font-weight: 850;
          text-transform: uppercase;
        }

        .paybank-detail-stat strong {
          display: block;
          overflow: hidden;
          font-size: 14px;
          text-overflow: ellipsis;
        }

        .paybank-note {
          padding: 12px 13px;
          border-left: 3px solid #6072dd;
          border-radius: 8px;
          background: rgba(54, 84, 201, 0.06);
          color: #3d4961;
          font-size: 13px;
          line-height: 1.55;
        }

        .paybank-warning {
          display: flex;
          align-items: flex-start;
          gap: 9px;
          padding: 12px 13px;
          border: 1px solid rgba(245, 158, 11, 0.3);
          border-radius: 11px;
          background: rgba(245, 158, 11, 0.08);
          color: #7b4c00;
          font-size: 12px;
          line-height: 1.5;
        }

        .paybank-empty {
          display: grid;
          place-items: center;
          min-height: 220px;
          padding: 30px;
          border: 1px dashed var(--border, #d7dee9);
          border-radius: 15px;
          color: var(--muted, #64748b);
          text-align: center;
        }

        .paybank-empty svg {
          margin-bottom: 10px;
          opacity: 0.6;
        }

        .paybank-timeline {
          display: grid;
          gap: 0;
          max-height: 310px;
          overflow: auto;
          margin-top: 14px;
          padding: 4px 13px;
          border: 1px solid var(--border, #dfe5ee);
          border-radius: 13px;
        }

        .paybank-timeline-item {
          padding: 11px 0;
          border-bottom: 1px solid rgba(226, 232, 240, 0.9);
        }

        .paybank-timeline-item:last-child {
          border-bottom: 0;
        }

        .paybank-timeline-item strong {
          display: block;
          margin-bottom: 3px;
          font-size: 12px;
        }

        .paybank-timeline-item p,
        .paybank-timeline-item small {
          display: block;
          margin: 0;
          color: var(--muted, #64748b);
          font-size: 11px;
          line-height: 1.45;
        }

        .paybank-run-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 13px;
        }

        .paybank-run-card {
          min-width: 0;
          padding: 16px;
          border: 1px solid var(--border, #dfe5ee);
          border-radius: 15px;
          background: #fff;
        }

        .paybank-run-card-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 12px;
        }

        .paybank-run-card h3 {
          margin: 0 0 4px;
          font-size: 17px;
        }

        .paybank-run-card p {
          margin: 0;
          color: var(--muted, #64748b);
          font-size: 12px;
        }

        .paybank-run-stats {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
          margin-bottom: 12px;
        }

        .paybank-run-stat {
          padding: 10px;
          border-radius: 10px;
          background: rgba(148, 163, 184, 0.08);
        }

        .paybank-run-stat span {
          display: block;
          margin-bottom: 3px;
          color: var(--muted, #64748b);
          font-size: 10px;
          font-weight: 850;
          text-transform: uppercase;
        }

        .paybank-run-stat strong {
          font-size: 14px;
        }

        .paybank-table-wrap {
          overflow-x: auto;
        }

        .paybank-table {
          width: 100%;
          min-width: 940px;
          border-collapse: collapse;
        }

        .paybank-table th,
        .paybank-table td {
          padding: 12px 11px;
          border-bottom: 1px solid #e7ebf1;
          text-align: left;
          vertical-align: top;
          font-size: 12px;
        }

        .paybank-table th {
          color: #58647a;
          background: rgba(148, 163, 184, 0.07);
          font-size: 11px;
          font-weight: 900;
          text-transform: uppercase;
        }

        .paybank-table td strong {
          display: block;
          margin-bottom: 3px;
        }

        .paybank-table td small {
          color: var(--muted, #64748b);
        }

        .paybank-modal-backdrop {
          position: fixed;
          inset: 0;
          z-index: 10020;
          display: grid;
          place-items: center;
          overflow: auto;
          padding: 22px;
          background: rgba(15, 23, 42, 0.58);
          backdrop-filter: blur(5px);
        }

        .paybank-modal {
          width: min(780px, 100%);
          max-height: calc(100vh - 44px);
          overflow: auto;
          border: 1px solid rgba(255, 255, 255, 0.35);
          border-radius: 20px;
          background: #fff;
          box-shadow: 0 30px 90px rgba(15, 23, 42, 0.3);
        }

        .paybank-modal-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          padding: 20px 22px 14px;
          border-bottom: 1px solid #e4e8ef;
        }

        .paybank-modal-head h2 {
          margin: 0 0 4px;
          font-size: 21px;
        }

        .paybank-modal-head p {
          margin: 0;
          color: #64748b;
          font-size: 13px;
        }

        .paybank-modal-close {
          width: 38px;
          height: 38px;
          border: 1px solid #dfe5ee;
          border-radius: 10px;
          background: #fff;
          color: #334155;
          cursor: pointer;
        }

        .paybank-modal-body {
          display: grid;
          gap: 15px;
          padding: 20px 22px;
        }

        .paybank-form-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 13px;
        }

        .paybank-field-full {
          grid-column: 1 / -1;
        }

        .paybank-modal-actions {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 10px;
          padding: 14px 22px 20px;
          border-top: 1px solid #e4e8ef;
        }

        .spin {
          animation: paybank-spin 0.9s linear infinite;
        }

        @keyframes paybank-spin {
          to {
            transform: rotate(360deg);
          }
        }

        @media (max-width: 1200px) {
          .paybank-metrics {
            grid-template-columns: repeat(3, minmax(145px, 1fr));
          }

          .paybank-toolbar {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .paybank-main-grid {
            grid-template-columns: 1fr;
          }

          .paybank-detail {
            position: static;
          }
        }

        @media (max-width: 850px) {
          .paybank-run-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 760px) {
          .paybank-hero {
            flex-direction: column;
            padding: 20px;
          }

          .paybank-hero-actions {
            width: 100%;
            justify-content: stretch;
          }

          .paybank-hero-actions .paybank-btn {
            flex: 1;
          }

          .paybank-metrics,
          .paybank-toolbar,
          .paybank-form-grid {
            grid-template-columns: 1fr;
          }

          .paybank-row {
            grid-template-columns: 1fr;
          }

          .paybank-row-end {
            text-align: left;
          }

          .paybank-actions.is-compact {
            justify-content: flex-start;
          }

          .paybank-modal-backdrop {
            align-items: end;
            padding: 0;
          }

          .paybank-modal {
            max-height: 94vh;
            border-radius: 20px 20px 0 0;
          }

          .paybank-modal-head,
          .paybank-modal-body,
          .paybank-modal-actions {
            padding-left: 16px;
            padding-right: 16px;
          }
        }
      `}</style>

      <header className="paybank-hero">
        <div className="paybank-hero-content">
          <span className="paybank-kicker">
            <Landmark size={15} />
            Secure Salary Banking
          </span>
          <h1>Payroll Banking</h1>
          <p>
            Maintain verified employee bank accounts, enforce maker-checker
            controls, snapshot payment instructions before payroll locking and
            generate auditable salary-disbursement CSV files.
          </p>
        </div>

        <div className="paybank-hero-actions">
          <button
            type="button"
            className="paybank-btn paybank-btn-secondary"
            onClick={() => refreshAll()}
            disabled={
              loadingBanks ||
              loadingEmployees ||
              loadingRuns ||
              loadingExports
            }
          >
            {loadingBanks ||
            loadingEmployees ||
            loadingRuns ||
            loadingExports ? (
              <Loader2 size={17} className="spin" />
            ) : (
              <RefreshCw size={17} />
            )}
            Refresh
          </button>

          <button
            type="button"
            className="paybank-btn paybank-btn-primary"
            onClick={() =>
              canManage
                ? openCreateBank(selectedEmployee)
                : openCreateBank()
            }
          >
            <Banknote size={17} />
            Add Bank Details
          </button>
        </div>
      </header>

      <nav className="paybank-tabs" aria-label="Payroll banking sections">
        <button
          type="button"
          className={`paybank-tab ${
            activeTab === 'bank_details' ? 'is-active' : ''
          }`}
          onClick={() => setActiveTab('bank_details')}
        >
          <UsersRound size={16} />
          Employee Bank Details
        </button>

        {canFinanceAct ? (
          <>
            <button
              type="button"
              className={`paybank-tab ${
                activeTab === 'disbursement' ? 'is-active' : ''
              }`}
              onClick={() => setActiveTab('disbursement')}
            >
              <FileSpreadsheet size={16} />
              Salary Disbursement
            </button>

            <button
              type="button"
              className={`paybank-tab ${
                activeTab === 'exports' ? 'is-active' : ''
              }`}
              onClick={() => setActiveTab('exports')}
            >
              <History size={16} />
              Bank Export History
            </button>
          </>
        ) : null}
      </nav>

      {activeTab === 'bank_details' ? (
        <>
          <section className="paybank-metrics">
            <article className="paybank-metric">
              <div className="paybank-metric-head">
                <span>Employees</span>
                <UsersRound size={17} />
              </div>
              <strong>{metrics.employees}</strong>
            </article>

            <article className="paybank-metric">
              <div className="paybank-metric-head">
                <span>Verified</span>
                <BadgeCheck size={17} />
              </div>
              <strong>{metrics.verified}</strong>
            </article>

            <article className="paybank-metric">
              <div className="paybank-metric-head">
                <span>Pending</span>
                <Clock3 size={17} />
              </div>
              <strong>{metrics.pending}</strong>
            </article>

            <article className="paybank-metric">
              <div className="paybank-metric-head">
                <span>Rejected</span>
                <ShieldX size={17} />
              </div>
              <strong>{metrics.rejected}</strong>
            </article>

            <article className="paybank-metric">
              <div className="paybank-metric-head">
                <span>Not added</span>
                <AlertTriangle size={17} />
              </div>
              <strong>{metrics.missing}</strong>
            </article>
          </section>

          <section className="paybank-panel">
            <div className="paybank-toolbar">
              <div className="paybank-field">
                <label htmlFor="paybank-search">Search employees or bank details</label>
                <div className="paybank-search-wrap">
                  <Search size={16} />
                  <input
                    id="paybank-search"
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Employee, bank, IFSC or account ending"
                  />
                </div>
              </div>

              <div className="paybank-field">
                <label htmlFor="paybank-verification-filter">
                  Verification status
                </label>
                <select
                  id="paybank-verification-filter"
                  value={verificationFilter}
                  onChange={(event) =>
                    setVerificationFilter(event.target.value)
                  }
                >
                  {VERIFICATION_FILTERS.map(([value, label]) => (
                    <option key={value || 'all'} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              {canManage ? (
                <div className="paybank-field">
                  <label htmlFor="paybank-employee-select">
                    Selected employee
                  </label>
                  <select
                    id="paybank-employee-select"
                    value={selectedEmployeeId}
                    onChange={(event) => {
                      const id = event.target.value;
                      setSelectedEmployeeId(id);
                      setSelectedBankRecord(recordsByEmployee.get(id) || null);
                    }}
                    disabled={loadingEmployees}
                  >
                    <option value="">Select employee</option>
                    {employees.map((employee) => (
                      <option
                        key={employeeId(employee)}
                        value={employeeId(employee)}
                      >
                        {employeeName(employee)} ({employeeCode(employee)})
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {canManage ? (
                <label className="paybank-checkbox">
                  <input
                    type="checkbox"
                    checked={includeInactive}
                    onChange={(event) =>
                      setIncludeInactive(event.target.checked)
                    }
                  />
                  Include inactive details
                </label>
              ) : null}

              {superAdmin ? (
                <div className="paybank-field">
                  <label htmlFor="paybank-tenant-id">
                    Company tenant ID
                  </label>
                  <input
                    id="paybank-tenant-id"
                    type="text"
                    value={tenantId}
                    onChange={(event) => setTenantId(event.target.value)}
                    placeholder="Example: sds"
                  />
                </div>
              ) : null}
            </div>
          </section>

          <div className="paybank-main-grid">
            <section className="paybank-panel">
              <div className="paybank-section-head">
                <div>
                  <h2>Employee Banking Records</h2>
                  <p>
                    {filteredBankRows.length} matching employee
                    {filteredBankRows.length === 1 ? '' : 's'}
                  </p>
                </div>

                {loadingBanks || loadingEmployees ? (
                  <Loader2 size={20} className="spin" />
                ) : null}
              </div>

              {filteredBankRows.length ? (
                <div className="paybank-list">
                  {filteredBankRows.map((record) => {
                    const id = safeText(record.employee_id, '');
                    const selected = id === selectedEmployeeId;
                    const hasDetails = record.has_bank_details !== false;

                    return (
                      <article
                        className={`paybank-row ${
                          selected ? 'is-selected' : ''
                        }`}
                        key={id}
                        role="button"
                        tabIndex={0}
                        onClick={() => selectBankRow(record)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            selectBankRow(record);
                          }
                        }}
                      >
                        <div>
                          <div className="paybank-row-title">
                            <strong>
                              {safeText(record.employee_name, 'Employee')}
                            </strong>
                            <span
                              className={`paybank-status paybank-status-${
                                hasDetails
                                  ? verificationTone(
                                      record.verification_status,
                                    )
                                  : 'neutral'
                              }`}
                            >
                              {hasDetails
                                ? labelFromKey(record.verification_status)
                                : 'Not Added'}
                            </span>
                          </div>

                          <div className="paybank-row-meta">
                            <span>
                              <UserRound size={13} />
                              {safeText(record.employee_code)}
                            </span>
                            <span>
                              <Landmark size={13} />
                              {hasDetails
                                ? safeText(record.bank_name)
                                : 'No bank details'}
                            </span>
                            <span>
                              <Fingerprint size={13} />
                              {hasDetails
                                ? maskDisplay(record)
                                : 'Not available'}
                            </span>
                          </div>

                          {renderBankActions(record, true)}
                        </div>

                        <div className="paybank-row-end">
                          <strong>
                            {hasDetails
                              ? safeText(record.ifsc_code)
                              : 'Pending setup'}
                          </strong>
                          <small>
                            {hasDetails
                              ? labelFromKey(record.payment_method)
                              : safeText(record.employee_email)}
                          </small>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="paybank-empty">
                  <div>
                    <Landmark size={34} />
                    <strong>No bank records found</strong>
                    <p>Add bank details or change the selected filters.</p>
                  </div>
                </div>
              )}
            </section>

            <aside className="paybank-panel paybank-detail">
              {selectedEmployeeId || selectedBank ? (
                <>
                  <div className="paybank-detail-head">
                    <div>
                      <h2>
                        {safeText(
                          selectedBank?.employee_name ||
                            employeeName(selectedEmployee || {}),
                          'Employee Banking',
                        )}
                      </h2>
                      <p>
                        {safeText(
                          selectedBank?.employee_code ||
                            employeeCode(selectedEmployee || {}),
                        )}
                      </p>
                    </div>

                    <span
                      className={`paybank-status paybank-status-${
                        selectedBank
                          ? verificationTone(
                              selectedBank.verification_status,
                            )
                          : 'neutral'
                      }`}
                    >
                      {selectedBank
                        ? labelFromKey(selectedBank.verification_status)
                        : 'Not Added'}
                    </span>
                  </div>

                  {selectedBank ? (
                    <>
                      <div className="paybank-detail-stats">
                        <article className="paybank-detail-stat">
                          <span>Account holder</span>
                          <strong>
                            {safeText(selectedBank.account_holder_name)}
                          </strong>
                        </article>
                        <article className="paybank-detail-stat">
                          <span>Account number</span>
                          <strong>{maskDisplay(selectedBank)}</strong>
                        </article>
                        <article className="paybank-detail-stat">
                          <span>Bank</span>
                          <strong>{safeText(selectedBank.bank_name)}</strong>
                        </article>
                        <article className="paybank-detail-stat">
                          <span>Branch</span>
                          <strong>{safeText(selectedBank.branch_name)}</strong>
                        </article>
                        <article className="paybank-detail-stat">
                          <span>IFSC</span>
                          <strong>{safeText(selectedBank.ifsc_code)}</strong>
                        </article>
                        <article className="paybank-detail-stat">
                          <span>Account type</span>
                          <strong>
                            {labelFromKey(selectedBank.account_type)}
                          </strong>
                        </article>
                        <article className="paybank-detail-stat">
                          <span>Payment method</span>
                          <strong>
                            {labelFromKey(selectedBank.payment_method)}
                          </strong>
                        </article>
                        <article className="paybank-detail-stat">
                          <span>Revision</span>
                          <strong>
                            #{toNumber(selectedBank.revision_number, 1)}
                          </strong>
                        </article>
                      </div>

                      {normalizeKey(
                        selectedBank.verification_status,
                      ) === 'pending_verification' ? (
                        <div className="paybank-warning">
                          <AlertTriangle size={17} />
                          <span>
                            This revision is awaiting independent Finance
                            verification and cannot be used for salary
                            disbursement yet.
                          </span>
                        </div>
                      ) : null}

                      {normalizeKey(
                        selectedBank.verification_status,
                      ) === 'rejected' ? (
                        <div className="paybank-warning">
                          <ShieldX size={17} />
                          <span>
                            <strong>Rejected:</strong>{' '}
                            {safeText(selectedBank.rejection_reason)}
                          </span>
                        </div>
                      ) : null}

                      {normalizeKey(
                        selectedBank.verification_status,
                      ) === 'verified' ? (
                        <div className="paybank-note">
                          <strong>Verified:</strong>{' '}
                          {formatDate(selectedBank.verified_at)} by{' '}
                          {safeText(selectedBank.verified_by_name, 'Finance')}
                        </div>
                      ) : null}

                      {renderBankActions(selectedBank)}

                      {Array.isArray(selectedBank.verification_history) &&
                      selectedBank.verification_history.length ? (
                        <div className="paybank-timeline">
                          {[...selectedBank.verification_history]
                            .reverse()
                            .map((entry, index) => (
                              <article
                                className="paybank-timeline-item"
                                key={`${safeText(entry.at, index)}-${index}`}
                              >
                                <strong>
                                  {labelFromKey(entry.decision)}
                                </strong>
                                <p>
                                  {safeText(entry.actor_name, 'System')} ·{' '}
                                  {formatDate(entry.at)}
                                </p>
                                {entry.note ? (
                                  <small>{entry.note}</small>
                                ) : null}
                              </article>
                            ))}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <div className="paybank-empty" style={{ minHeight: 165 }}>
                        <div>
                          <Banknote size={30} />
                          <strong>Bank details not added</strong>
                          <p>
                            Create and submit the employee’s banking information
                            for verification.
                          </p>
                        </div>
                      </div>

                      <div className="paybank-actions">
                        <button
                          type="button"
                          className="paybank-btn paybank-btn-primary"
                          onClick={() =>
                            openCreateBank(selectedEmployee)
                          }
                        >
                          <Banknote size={15} />
                          Add Bank Details
                        </button>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <div className="paybank-empty">
                  <div>
                    <UserRound size={34} />
                    <strong>Select an employee</strong>
                    <p>
                      Select a record to view verification and bank information.
                    </p>
                  </div>
                </div>
              )}
            </aside>
          </div>
        </>
      ) : null}

      {activeTab === 'disbursement' && canFinanceAct ? (
        <>
          <section className="paybank-panel">
            <div className="paybank-toolbar">
              <div className="paybank-field">
                <label htmlFor="paybank-period-filter">
                  Payroll period
                </label>
                <input
                  id="paybank-period-filter"
                  type="month"
                  value={periodFilter}
                  onChange={(event) => setPeriodFilter(event.target.value)}
                />
              </div>

              <div className="paybank-field">
                <label htmlFor="paybank-run-select">Payroll run</label>
                <select
                  id="paybank-run-select"
                  value={selectedRunId}
                  onChange={(event) => setSelectedRunId(event.target.value)}
                  disabled={loadingRuns}
                >
                  <option value="">Select payroll run</option>
                  {filteredRuns.map((run) => (
                    <option
                      key={runIdentifier(run)}
                      value={runIdentifier(run)}
                    >
                      {periodLabel(run)} · {labelFromKey(run.status)}
                    </option>
                  ))}
                </select>
              </div>

              {superAdmin ? (
                <div className="paybank-field">
                  <label htmlFor="paybank-disbursement-tenant">
                    Company tenant ID
                  </label>
                  <input
                    id="paybank-disbursement-tenant"
                    type="text"
                    value={tenantId}
                    onChange={(event) => setTenantId(event.target.value)}
                    placeholder="Example: sds"
                  />
                </div>
              ) : null}
            </div>
          </section>

          <section className="paybank-panel">
            <div className="paybank-section-head">
              <div>
                <h2>Payroll Runs Ready for Banking</h2>
                <p>
                  Finance-approved runs can prepare snapshots. Locked and
                  disbursed runs can generate salary bank files.
                </p>
              </div>

              {loadingRuns ? (
                <Loader2 size={20} className="spin" />
              ) : null}
            </div>

            {filteredRuns.length ? (
              <div className="paybank-run-grid">
                {filteredRuns.map((run) => {
                  const id = runIdentifier(run);
                  const status = normalizeKey(run.status);
                  const preparing =
                    actionLoading === `snapshot-${id}`;
                  const exporting =
                    actionLoading === `export-${id}`;

                  return (
                    <article
                      className="paybank-run-card"
                      key={id}
                    >
                      <div className="paybank-run-card-head">
                        <div>
                          <h3>{periodLabel(run)}</h3>
                          <p>Run ID: {id}</p>
                        </div>

                        <span
                          className={`paybank-status paybank-status-${runTone(
                            status,
                          )}`}
                        >
                          {labelFromKey(status)}
                        </span>
                      </div>

                      <div className="paybank-run-stats">
                        <article className="paybank-run-stat">
                          <span>Employees</span>
                          <strong>{runEmployeeCount(run)}</strong>
                        </article>
                        <article className="paybank-run-stat">
                          <span>Net payable</span>
                          <strong>{formatCurrency(runAmount(run))}</strong>
                        </article>
                      </div>

                      <div className="paybank-actions">
                        {SNAPSHOT_READY_RUN_STATUSES.has(status) ? (
                          <button
                            type="button"
                            className="paybank-btn paybank-btn-secondary"
                            onClick={() => prepareSnapshots(run)}
                            disabled={Boolean(actionLoading)}
                          >
                            {preparing ? (
                              <Loader2 size={15} className="spin" />
                            ) : (
                              <ShieldCheck size={15} />
                            )}
                            Prepare Snapshots
                          </button>
                        ) : null}

                        {EXPORTABLE_RUN_STATUSES.has(status) ? (
                          <button
                            type="button"
                            className="paybank-btn paybank-btn-primary"
                            onClick={() => openExport(run)}
                            disabled={Boolean(actionLoading)}
                          >
                            {exporting ? (
                              <Loader2 size={15} className="spin" />
                            ) : (
                              <Download size={15} />
                            )}
                            Generate Bank CSV
                          </button>
                        ) : (
                          <span className="paybank-warning">
                            <LockKeyhole size={15} />
                            Lock payroll before generating the bank file.
                          </span>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="paybank-empty">
                <div>
                  <WalletCards size={34} />
                  <strong>No eligible payroll runs found</strong>
                  <p>
                    Complete Finance approval for a payroll run or change the
                    period filter.
                  </p>
                </div>
              </div>
            )}
          </section>
        </>
      ) : null}

      {activeTab === 'exports' && canFinanceAct ? (
        <>
          <section className="paybank-panel">
            <div className="paybank-toolbar">
              <div className="paybank-field">
                <label htmlFor="paybank-export-period">
                  Payroll period
                </label>
                <input
                  id="paybank-export-period"
                  type="month"
                  value={periodFilter}
                  onChange={(event) => setPeriodFilter(event.target.value)}
                />
              </div>

              <div className="paybank-field">
                <label htmlFor="paybank-export-status">
                  Export status
                </label>
                <select
                  id="paybank-export-status"
                  value={exportStatusFilter}
                  onChange={(event) =>
                    setExportStatusFilter(event.target.value)
                  }
                >
                  <option value="">All statuses</option>
                  {EXPORT_STATUS_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              {superAdmin ? (
                <div className="paybank-field">
                  <label htmlFor="paybank-export-tenant">
                    Company tenant ID
                  </label>
                  <input
                    id="paybank-export-tenant"
                    type="text"
                    value={tenantId}
                    onChange={(event) => setTenantId(event.target.value)}
                    placeholder="Example: sds"
                  />
                </div>
              ) : null}
            </div>
          </section>

          <section className="paybank-panel">
            <div className="paybank-section-head">
              <div>
                <h2>Bank Export History</h2>
                <p>
                  Generated files are recorded with transaction totals and a
                  SHA-256 integrity hash.
                </p>
              </div>

              {loadingExports ? (
                <Loader2 size={20} className="spin" />
              ) : null}
            </div>

            {filteredExports.length ? (
              <div className="paybank-table-wrap">
                <table className="paybank-table">
                  <thead>
                    <tr>
                      <th>Payroll period</th>
                      <th>File</th>
                      <th>Transactions</th>
                      <th>Total amount</th>
                      <th>Integrity hash</th>
                      <th>Status</th>
                      <th>Generated</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredExports.map((record) => (
                      <tr key={recordId(record)}>
                        <td>
                          <strong>{safeText(record.period_key)}</strong>
                          <small>{safeText(record.run_id)}</small>
                        </td>
                        <td>
                          <strong>{safeText(record.filename)}</strong>
                          <small>
                            {safeText(record.export_format)} · v
                            {safeText(record.export_version, '1')}
                          </small>
                        </td>
                        <td>{toNumber(record.transaction_count)}</td>
                        <td>{formatCurrency(record.total_amount)}</td>
                        <td>
                          <strong>
                            {safeText(record.sha256, '').slice(0, 16)}
                            {record.sha256 ? '…' : '—'}
                          </strong>
                        </td>
                        <td>
                          <span
                            className={`paybank-status paybank-status-${exportTone(
                              record.status,
                            )}`}
                          >
                            {labelFromKey(record.status)}
                          </span>
                        </td>
                        <td>{formatDate(record.created_at)}</td>
                        <td>
                          <button
                            type="button"
                            className="paybank-btn paybank-btn-secondary"
                            onClick={() => openExportStatus(record)}
                          >
                            <FileCheck2 size={14} />
                            Update Status
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="paybank-empty">
                <div>
                  <FileSpreadsheet size={34} />
                  <strong>No bank exports found</strong>
                  <p>
                    Generate a salary bank file or change the selected filters.
                  </p>
                </div>
              </div>
            )}
          </section>
        </>
      ) : null}

      {showBankForm ? (
        <div className="paybank-modal-backdrop" role="presentation">
          <div
            className="paybank-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="paybank-form-title"
          >
            <div className="paybank-modal-head">
              <div>
                <h2 id="paybank-form-title">
                  {bankFormMode === 'edit'
                    ? 'Update Bank Details'
                    : 'Add Bank Details'}
                </h2>
                <p>
                  Changes create a new revision and reset verification status.
                </p>
              </div>

              <button
                type="button"
                className="paybank-modal-close"
                onClick={closeBankForm}
                aria-label="Close"
                disabled={savingBank}
              >
                ×
              </button>
            </div>

            <form onSubmit={saveBankDetails}>
              <div className="paybank-modal-body">
                <div className="paybank-warning">
                  <KeyRound size={17} />
                  <span>
                    Account numbers are masked in normal responses. Enter a
                    complete number only when creating or replacing the account.
                  </span>
                </div>

                <div className="paybank-form-grid">
                  {canManage ? (
                    <div className="paybank-field paybank-field-full">
                      <label htmlFor="paybank-form-employee">
                        Employee *
                      </label>
                      <select
                        id="paybank-form-employee"
                        value={bankForm.employee_id}
                        onChange={(event) =>
                          updateBankForm(
                            'employee_id',
                            event.target.value,
                          )
                        }
                        disabled={bankFormMode === 'edit' || loadingEmployees}
                        required
                      >
                        <option value="">Select employee</option>
                        {employees.map((employee) => (
                          <option
                            key={employeeId(employee)}
                            value={employeeId(employee)}
                          >
                            {employeeName(employee)} ({employeeCode(employee)})
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}

                  <div className="paybank-field paybank-field-full">
                    <label htmlFor="paybank-holder-name">
                      Account holder name *
                    </label>
                    <input
                      id="paybank-holder-name"
                      type="text"
                      value={bankForm.account_holder_name}
                      onChange={(event) =>
                        updateBankForm(
                          'account_holder_name',
                          event.target.value,
                        )
                      }
                      maxLength={120}
                      required
                    />
                  </div>

                  <div className="paybank-field paybank-field-full">
                    <label htmlFor="paybank-account-number">
                      {bankFormMode === 'edit'
                        ? 'New account number'
                        : 'Account number *'}
                    </label>
                    <input
                      id="paybank-account-number"
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      value={bankForm.account_number}
                      onChange={(event) =>
                        updateBankForm(
                          'account_number',
                          event.target.value,
                        )
                      }
                      placeholder={
                        bankFormMode === 'edit'
                          ? 'Leave blank to retain the current number'
                          : 'Enter complete account number'
                      }
                      required={bankFormMode === 'create'}
                    />
                  </div>

                  <div className="paybank-field">
                    <label htmlFor="paybank-ifsc">IFSC code *</label>
                    <input
                      id="paybank-ifsc"
                      type="text"
                      value={bankForm.ifsc_code}
                      onChange={(event) =>
                        updateBankForm(
                          'ifsc_code',
                          event.target.value.toUpperCase(),
                        )
                      }
                      maxLength={11}
                      placeholder="ABCD0123456"
                      required
                    />
                  </div>

                  <div className="paybank-field">
                    <label htmlFor="paybank-bank-name">Bank name *</label>
                    <input
                      id="paybank-bank-name"
                      type="text"
                      value={bankForm.bank_name}
                      onChange={(event) =>
                        updateBankForm('bank_name', event.target.value)
                      }
                      maxLength={120}
                      required
                    />
                  </div>

                  <div className="paybank-field">
                    <label htmlFor="paybank-branch-name">Branch name</label>
                    <input
                      id="paybank-branch-name"
                      type="text"
                      value={bankForm.branch_name}
                      onChange={(event) =>
                        updateBankForm('branch_name', event.target.value)
                      }
                      maxLength={120}
                    />
                  </div>

                  <div className="paybank-field">
                    <label htmlFor="paybank-account-type">
                      Account type *
                    </label>
                    <select
                      id="paybank-account-type"
                      value={bankForm.account_type}
                      onChange={(event) =>
                        updateBankForm(
                          'account_type',
                          event.target.value,
                        )
                      }
                      required
                    >
                      {BANK_ACCOUNT_TYPES.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="paybank-field">
                    <label htmlFor="paybank-payment-method">
                      Preferred payment method *
                    </label>
                    <select
                      id="paybank-payment-method"
                      value={bankForm.payment_method}
                      onChange={(event) =>
                        updateBankForm(
                          'payment_method',
                          event.target.value,
                        )
                      }
                      required
                    >
                      {PAYMENT_METHODS.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="paybank-field">
                    <label htmlFor="paybank-beneficiary-code">
                      Beneficiary code *
                    </label>
                    <input
                      id="paybank-beneficiary-code"
                      type="text"
                      value={bankForm.beneficiary_code}
                      onChange={(event) =>
                        updateBankForm(
                          'beneficiary_code',
                          event.target.value.toUpperCase(),
                        )
                      }
                      maxLength={40}
                      required
                    />
                  </div>

                  <div className="paybank-field">
                    <label htmlFor="paybank-effective-from">
                      Effective from
                    </label>
                    <input
                      id="paybank-effective-from"
                      type="date"
                      value={bankForm.effective_from}
                      onChange={(event) =>
                        updateBankForm(
                          'effective_from',
                          event.target.value,
                        )
                      }
                    />
                  </div>

                  <div className="paybank-field paybank-field-full">
                    <label htmlFor="paybank-change-note">
                      Change note
                    </label>
                    <textarea
                      id="paybank-change-note"
                      value={bankForm.note}
                      onChange={(event) =>
                        updateBankForm('note', event.target.value)
                      }
                      placeholder="Explain the reason for this bank-detail submission or revision."
                    />
                  </div>
                </div>
              </div>

              <div className="paybank-modal-actions">
                <button
                  type="button"
                  className="paybank-btn paybank-btn-secondary"
                  onClick={closeBankForm}
                  disabled={savingBank}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="paybank-btn paybank-btn-primary"
                  disabled={savingBank}
                >
                  {savingBank ? (
                    <Loader2 size={16} className="spin" />
                  ) : (
                    <Send size={16} />
                  )}
                  Save for Verification
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {showDecisionModal && decisionRecord ? (
        <div className="paybank-modal-backdrop" role="presentation">
          <div
            className="paybank-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="paybank-decision-title"
          >
            <div className="paybank-modal-head">
              <div>
                <h2 id="paybank-decision-title">
                  {decisionForm.decision === 'verified'
                    ? 'Verify Bank Details'
                    : 'Reject Bank Details'}
                </h2>
                <p>
                  {safeText(decisionRecord.employee_name, 'Employee')} ·{' '}
                  {maskDisplay(decisionRecord)}
                </p>
              </div>

              <button
                type="button"
                className="paybank-modal-close"
                onClick={closeDecisionModal}
                aria-label="Close"
                disabled={Boolean(actionLoading)}
              >
                ×
              </button>
            </div>

            <form onSubmit={saveVerificationDecision}>
              <div className="paybank-modal-body">
                <div className="paybank-warning">
                  <ShieldCheck size={17} />
                  <span>
                    The backend enforces maker-checker separation. A user who
                    last changed this revision cannot verify it.
                  </span>
                </div>

                <div className="paybank-field">
                  <label htmlFor="paybank-decision-note">
                    {decisionForm.decision === 'rejected'
                      ? 'Rejection reason *'
                      : 'Verification note'}
                  </label>
                  <textarea
                    id="paybank-decision-note"
                    value={decisionForm.note}
                    onChange={(event) =>
                      setDecisionForm((current) => ({
                        ...current,
                        note: event.target.value,
                      }))
                    }
                    required={decisionForm.decision === 'rejected'}
                    placeholder={
                      decisionForm.decision === 'rejected'
                        ? 'Explain what must be corrected.'
                        : 'Optional verification note.'
                    }
                  />
                </div>
              </div>

              <div className="paybank-modal-actions">
                <button
                  type="button"
                  className="paybank-btn paybank-btn-secondary"
                  onClick={closeDecisionModal}
                  disabled={Boolean(actionLoading)}
                >
                  Go Back
                </button>
                <button
                  type="submit"
                  className={`paybank-btn ${
                    decisionForm.decision === 'verified'
                      ? 'paybank-btn-success'
                      : 'paybank-btn-danger'
                  }`}
                  disabled={Boolean(actionLoading)}
                >
                  {actionLoading ? (
                    <Loader2 size={16} className="spin" />
                  ) : decisionForm.decision === 'verified' ? (
                    <BadgeCheck size={16} />
                  ) : (
                    <ShieldX size={16} />
                  )}
                  {decisionForm.decision === 'verified'
                    ? 'Verify Details'
                    : 'Reject Details'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {showDeactivateModal && deactivateRecord ? (
        <div className="paybank-modal-backdrop" role="presentation">
          <div
            className="paybank-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="paybank-deactivate-title"
          >
            <div className="paybank-modal-head">
              <div>
                <h2 id="paybank-deactivate-title">
                  Deactivate Bank Details
                </h2>
                <p>
                  {safeText(deactivateRecord.employee_name, 'Employee')} ·{' '}
                  {maskDisplay(deactivateRecord)}
                </p>
              </div>

              <button
                type="button"
                className="paybank-modal-close"
                onClick={closeDeactivateModal}
                aria-label="Close"
                disabled={Boolean(actionLoading)}
              >
                ×
              </button>
            </div>

            <form onSubmit={deactivateBankRecord}>
              <div className="paybank-modal-body">
                <div className="paybank-warning">
                  <AlertTriangle size={17} />
                  <span>
                    Deactivated bank details cannot be used for future salary
                    snapshots or disbursement files.
                  </span>
                </div>

                <div className="paybank-field">
                  <label htmlFor="paybank-deactivate-reason">
                    Deactivation reason *
                  </label>
                  <textarea
                    id="paybank-deactivate-reason"
                    value={deactivateReason}
                    onChange={(event) =>
                      setDeactivateReason(event.target.value)
                    }
                    placeholder="Enter a clear reason."
                    required
                  />
                </div>
              </div>

              <div className="paybank-modal-actions">
                <button
                  type="button"
                  className="paybank-btn paybank-btn-secondary"
                  onClick={closeDeactivateModal}
                  disabled={Boolean(actionLoading)}
                >
                  Keep Active
                </button>
                <button
                  type="submit"
                  className="paybank-btn paybank-btn-danger"
                  disabled={Boolean(actionLoading)}
                >
                  {actionLoading ? (
                    <Loader2 size={16} className="spin" />
                  ) : (
                    <Ban size={16} />
                  )}
                  Deactivate
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {showExportModal && exportRun ? (
        <div className="paybank-modal-backdrop" role="presentation">
          <div
            className="paybank-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="paybank-export-title"
          >
            <div className="paybank-modal-head">
              <div>
                <h2 id="paybank-export-title">
                  Generate Salary Bank CSV
                </h2>
                <p>
                  Payroll period {periodLabel(exportRun)} ·{' '}
                  {labelFromKey(exportRun.status)}
                </p>
              </div>

              <button
                type="button"
                className="paybank-modal-close"
                onClick={closeExportModal}
                aria-label="Close"
                disabled={Boolean(actionLoading)}
              >
                ×
              </button>
            </div>

            <form onSubmit={downloadBankFile}>
              <div className="paybank-modal-body">
                <div className="paybank-warning">
                  <LockKeyhole size={17} />
                  <span>
                    The CSV uses immutable bank snapshots stored on locked
                    payslips. Current employee bank-detail changes do not alter
                    this file.
                  </span>
                </div>

                <div className="paybank-form-grid">
                  <div className="paybank-field">
                    <label htmlFor="paybank-export-format">
                      Export format *
                    </label>
                    <input
                      id="paybank-export-format"
                      type="text"
                      value={exportForm.export_format}
                      onChange={(event) =>
                        setExportForm((current) => ({
                          ...current,
                          export_format: event.target.value,
                        }))
                      }
                      required
                    />
                  </div>

                  <div className="paybank-field">
                    <label htmlFor="paybank-export-version">
                      Format version *
                    </label>
                    <input
                      id="paybank-export-version"
                      type="text"
                      value={exportForm.export_version}
                      onChange={(event) =>
                        setExportForm((current) => ({
                          ...current,
                          export_version: event.target.value,
                        }))
                      }
                      required
                    />
                  </div>

                  <div className="paybank-field paybank-field-full">
                    <label htmlFor="paybank-narration-prefix">
                      Narration prefix *
                    </label>
                    <input
                      id="paybank-narration-prefix"
                      type="text"
                      value={exportForm.narration_prefix}
                      onChange={(event) =>
                        setExportForm((current) => ({
                          ...current,
                          narration_prefix: event.target.value,
                        }))
                      }
                      maxLength={50}
                      required
                    />
                  </div>

                  <div className="paybank-field">
                    <label htmlFor="paybank-delimiter">CSV delimiter *</label>
                    <select
                      id="paybank-delimiter"
                      value={exportForm.delimiter}
                      onChange={(event) =>
                        setExportForm((current) => ({
                          ...current,
                          delimiter: event.target.value,
                        }))
                      }
                    >
                      <option value=",">Comma (,)</option>
                      <option value=";">Semicolon (;)</option>
                      <option value="|">Pipe (|)</option>
                      <option value={'\t'}>Tab</option>
                    </select>
                  </div>

                  <label className="paybank-checkbox">
                    <input
                      type="checkbox"
                      checked={exportForm.include_utf8_bom}
                      onChange={(event) =>
                        setExportForm((current) => ({
                          ...current,
                          include_utf8_bom: event.target.checked,
                        }))
                      }
                    />
                    Add UTF-8 BOM for Excel compatibility
                  </label>
                </div>
              </div>

              <div className="paybank-modal-actions">
                <button
                  type="button"
                  className="paybank-btn paybank-btn-secondary"
                  onClick={closeExportModal}
                  disabled={Boolean(actionLoading)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="paybank-btn paybank-btn-primary"
                  disabled={Boolean(actionLoading)}
                >
                  {actionLoading ? (
                    <Loader2 size={16} className="spin" />
                  ) : (
                    <Download size={16} />
                  )}
                  Generate and Download
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {showExportStatusModal && selectedExport ? (
        <div className="paybank-modal-backdrop" role="presentation">
          <div
            className="paybank-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="paybank-export-status-title"
          >
            <div className="paybank-modal-head">
              <div>
                <h2 id="paybank-export-status-title">
                  Update Bank Export Status
                </h2>
                <p>{safeText(selectedExport.filename)}</p>
              </div>

              <button
                type="button"
                className="paybank-modal-close"
                onClick={closeExportStatusModal}
                aria-label="Close"
                disabled={Boolean(actionLoading)}
              >
                ×
              </button>
            </div>

            <form onSubmit={saveExportStatus}>
              <div className="paybank-modal-body">
                <div className="paybank-form-grid">
                  <div className="paybank-field">
                    <label htmlFor="paybank-status-value">Status *</label>
                    <select
                      id="paybank-status-value"
                      value={exportStatusForm.status}
                      onChange={(event) =>
                        setExportStatusForm((current) => ({
                          ...current,
                          status: event.target.value,
                        }))
                      }
                      required
                    >
                      {EXPORT_STATUS_OPTIONS.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="paybank-field">
                    <label htmlFor="paybank-bank-reference">
                      Bank reference
                    </label>
                    <input
                      id="paybank-bank-reference"
                      type="text"
                      value={exportStatusForm.reference}
                      onChange={(event) =>
                        setExportStatusForm((current) => ({
                          ...current,
                          reference: event.target.value,
                        }))
                      }
                      placeholder="Upload ID, batch ID or bank reference"
                    />
                  </div>

                  <div className="paybank-field paybank-field-full">
                    <label htmlFor="paybank-status-note">
                      Status note
                    </label>
                    <textarea
                      id="paybank-status-note"
                      value={exportStatusForm.note}
                      onChange={(event) =>
                        setExportStatusForm((current) => ({
                          ...current,
                          note: event.target.value,
                        }))
                      }
                      placeholder="Optional audit note."
                    />
                  </div>
                </div>
              </div>

              <div className="paybank-modal-actions">
                <button
                  type="button"
                  className="paybank-btn paybank-btn-secondary"
                  onClick={closeExportStatusModal}
                  disabled={Boolean(actionLoading)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="paybank-btn paybank-btn-primary"
                  disabled={Boolean(actionLoading)}
                >
                  {actionLoading ? (
                    <Loader2 size={16} className="spin" />
                  ) : (
                    <FileCheck2 size={16} />
                  )}
                  Update Status
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}