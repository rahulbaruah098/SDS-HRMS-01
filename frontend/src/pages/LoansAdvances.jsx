import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  Ban,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  Clock3,
  CreditCard,
  FilePenLine,
  History,
  IndianRupee,
  Landmark,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Send,
  SlidersHorizontal,
  UserRound,
  WalletCards,
  XCircle,
} from 'lucide-react';

import { api } from '../api/client';
import { useCustomAlert } from '../components/CustomAlertProvider.jsx';

const DEFAULT_LIMIT = 500;

const LOAN_TYPES = [
  ['work_advance', 'Work Advance'],
  ['tour_advance', 'Tour Advance'],
  ['personal_advance', 'Personal Advance'],
  ['salary_advance', 'Salary Advance'],
  ['employee_loan', 'Employee Loan'],
  ['other_advance', 'Other Advance'],
];

const FILTER_STATUSES = [
  ['', 'All statuses'],
  ['draft', 'Draft'],
  ['pending_approval', 'Pending Approval'],
  ['approved', 'Approved'],
  ['disbursed', 'Disbursed'],
  ['recovering', 'Recovering'],
  ['closed', 'Closed'],
  ['rejected', 'Rejected'],
  ['cancelled', 'Cancelled'],
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

const CANCELLABLE_STATUSES = new Set([
  'draft',
  'pending_approval',
  'approved',
]);

const RECOVERY_STATUSES = new Set([
  'active',
  'disbursed',
  'recovering',
]);

function safeText(value, fallback = '—') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
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

function statusTone(value) {
  const status = normalizeKey(value);

  if (['approved', 'disbursed', 'recovering', 'closed', 'active'].includes(status)) {
    return 'success';
  }

  if (['pending_approval'].includes(status)) {
    return 'info';
  }

  if (['rejected', 'cancelled'].includes(status)) {
    return 'danger';
  }

  return 'warning';
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

function sortEmployees(items = []) {
  return [...items].sort((left, right) =>
    employeeName(left).localeCompare(employeeName(right), 'en', {
      sensitivity: 'base',
    }),
  );
}

function emptyDraft() {
  return {
    employee_id: '',
    type: 'personal_advance',
    label: '',
    requested_amount: '',
    purpose: '',
    request_note: '',
  };
}

function emptyActionForm() {
  return {
    approved_amount: '',
    interest_amount: '0',
    emi_amount: '',
    recovery_start_period: '',
    recovery_end_period: '',
    note: '',
    reason: '',
    transfer_date: '',
    transfer_mode: '',
    transaction_reference: '',
    bank_reference: '',
    effective_from_period: '',
    hold_periods: '',
    custom_installments: [],
  };
}

function normalizeInstallmentRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    period_key: safeText(row.period_key || row.period, ''),
    amount: safeText(row.amount || row.deduction_amount, ''),
    status: normalizeKey(row.status || 'scheduled') || 'scheduled',
    note: safeText(row.note, ''),
  }));
}

function parseCommaPeriods(value) {
  return [
    ...new Set(
      String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function getRecordAmount(record = {}) {
  return toNumber(
    record.approved_amount ||
      record.requested_amount ||
      record.amount,
    0,
  );
}

function remainingBalance(record = {}) {
  return toNumber(record.remaining_balance, getRecordAmount(record));
}

function recoveredAmount(record = {}) {
  return toNumber(record.recovered_amount, 0);
}

function workflowHistory(record = {}) {
  return Array.isArray(record.workflow_history)
    ? [...record.workflow_history].reverse()
    : [];
}

function recoveryHistory(record = {}) {
  return Array.isArray(record.recovery_history)
    ? [...record.recovery_history].reverse()
    : [];
}

function latestRecoveryRevision(record = {}) {
  const revisions = Array.isArray(record.recovery_term_revisions)
    ? record.recovery_term_revisions
    : [];

  return revisions.length ? revisions[revisions.length - 1] : null;
}

function loanTypeLabel(value) {
  const normalized = normalizeKey(value);
  return LOAN_TYPES.find(([key]) => key === normalized)?.[1] || labelFromKey(value);
}

function actionTitle(action) {
  const titles = {
    approve: 'Approve Loan or Advance',
    reject: 'Reject Loan or Advance',
    disburse: 'Record Disbursement',
    cancel: 'Cancel Loan or Advance',
    recovery: 'Revise Recovery Terms',
  };

  return titles[action] || 'Loan or Advance Action';
}

export default function LoansAdvances({ user = {} }) {
  const alerts = useCustomAlert();
  const superAdmin = isSuperAdmin(user);
  const canManage = hasAnyRole(user, MANAGEMENT_ROLES);
  const canFinanceAct = hasAnyRole(user, FINANCE_ACTION_ROLES);

  const [tenantId, setTenantId] = useState(
    safeText(user.tenant_id || user.tenant?.tenant_id || user.tenant?.code, ''),
  );
  const [employees, setEmployees] = useState([]);
  const [items, setItems] = useState([]);
  const [selectedRecord, setSelectedRecord] = useState(null);

  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [search, setSearch] = useState('');

  const [loading, setLoading] = useState(false);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState('');

  const [showDraftForm, setShowDraftForm] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null);
  const [draft, setDraft] = useState(emptyDraft());

  const [actionModal, setActionModal] = useState('');
  const [actionRecord, setActionRecord] = useState(null);
  const [actionForm, setActionForm] = useState(emptyActionForm());

  const [showWorkflow, setShowWorkflow] = useState(true);
  const [showRecoveries, setShowRecoveries] = useState(false);

  const filteredItems = useMemo(() => {
    const term = normalizeKey(search);

    if (!term) {
      return items;
    }

    return items.filter((item) => {
      const haystack = [
        item.employee_name,
        item.employee_code,
        item.label,
        item.type,
        item.category,
        item.status,
        item.purpose,
        item.request_note,
      ]
        .map(normalizeKey)
        .join(' ');

      return haystack.includes(term);
    });
  }, [items, search]);

  const metrics = useMemo(() => {
    const pending = items.filter(
      (item) => normalizeKey(item.status) === 'pending_approval',
    ).length;
    const active = items.filter((item) =>
      ['disbursed', 'recovering', 'active'].includes(normalizeKey(item.status)),
    );
    const outstanding = active.reduce(
      (total, item) => total + remainingBalance(item),
      0,
    );
    const recovered = items.reduce(
      (total, item) => total + recoveredAmount(item),
      0,
    );

    return {
      total: items.length,
      pending,
      active: active.length,
      outstanding,
      recovered,
    };
  }, [items]);

  function tenantParams() {
    if (!superAdmin || !tenantId.trim()) {
      return {};
    }

    return { tenant_id: tenantId.trim() };
  }

  function assertTenant() {
    if (superAdmin && !tenantId.trim()) {
      alerts.warning(
        'Enter the company tenant ID before loading or changing loan records.',
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

  async function loadItems({
    silent = false,
    preferredId = '',
  } = {}) {
    if (!assertTenant()) {
      setItems([]);
      setSelectedRecord(null);
      return [];
    }

    try {
      setLoading(true);

      const data = await api(
        `/payroll/loans${buildQuery({
          ...tenantParams(),
          status: statusFilter,
          type: typeFilter,
          employee_id: canManage ? employeeFilter : '',
          limit: DEFAULT_LIMIT,
        })}`,
      );
      const rows = Array.isArray(data.items) ? data.items : [];

      setItems(rows);

      const desiredId =
        preferredId ||
        recordId(selectedRecord);

      if (desiredId) {
        const updatedSelection = rows.find(
          (row) => recordId(row) === desiredId,
        );

        if (updatedSelection) {
          setSelectedRecord(updatedSelection);
        } else {
          setSelectedRecord(null);
        }
      }

      return rows;
    } catch (error) {
      setItems([]);
      setSelectedRecord(null);

      if (!silent) {
        alerts.error(
          error.message || 'Unable to load loans and advances.',
          'Loan Records Load Failed',
        );
      }

      return [];
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(id, { silent = false } = {}) {
    if (!id || !assertTenant()) {
      return null;
    }

    try {
      setLoadingDetail(true);

      const data = await api(
        `/payroll/loans/${encodeURIComponent(id)}${buildQuery(tenantParams())}`,
      );
      const record = data.loan_advance || null;

      setSelectedRecord(record);
      return record;
    } catch (error) {
      if (!silent) {
        alerts.error(
          error.message || 'Unable to load loan details.',
          'Loan Detail Failed',
        );
      }
      return null;
    } finally {
      setLoadingDetail(false);
    }
  }

  async function refreshAll({ silent = false, preferredId = '' } = {}) {
    const tasks = [loadItems({ silent, preferredId })];

    if (canManage) {
      tasks.push(loadEmployees({ silent: true }));
    }

    await Promise.all(tasks);
  }

  useEffect(() => {
    if (superAdmin && !tenantId.trim()) {
      setItems([]);
      setEmployees([]);
      setSelectedRecord(null);
      return;
    }

    refreshAll({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  useEffect(() => {
    if (superAdmin && !tenantId.trim()) {
      return;
    }

    loadItems({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, typeFilter, employeeFilter]);

  function openCreate() {
    if (!assertTenant()) {
      return;
    }

    setEditingRecord(null);
    setDraft(emptyDraft());
    setShowDraftForm(true);
  }

  function openEdit(record) {
    setEditingRecord(record);
    setDraft({
      employee_id: safeText(record.employee_id, ''),
      type: normalizeKey(record.type || record.loan_type) || 'personal_advance',
      label: safeText(record.label, ''),
      requested_amount: safeText(record.requested_amount, ''),
      purpose: safeText(record.purpose, ''),
      request_note: safeText(record.request_note, ''),
    });
    setShowDraftForm(true);
  }

  function closeDraftForm(force = false) {
    if (saving && !force) {
      return;
    }

    setShowDraftForm(false);
    setEditingRecord(null);
    setDraft(emptyDraft());
  }

  function validateDraft() {
    if (canManage && !draft.employee_id) {
      return 'Select an employee.';
    }

    if (!draft.type) {
      return 'Select a loan or advance type.';
    }

    if (toNumber(draft.requested_amount, 0) <= 0) {
      return 'Requested amount must be greater than zero.';
    }

    if (!draft.purpose.trim()) {
      return 'Enter the purpose of the loan or advance.';
    }

    return '';
  }

  async function saveDraft(event) {
    event.preventDefault();

    const validationMessage = validateDraft();

    if (validationMessage) {
      alerts.warning(validationMessage, 'Draft Details Required');
      return;
    }

    if (!assertTenant()) {
      return;
    }

    const editingId = recordId(editingRecord);

    try {
      setSaving(true);

      const payload = {
        ...tenantParams(),
        type: draft.type,
        label: draft.label.trim(),
        requested_amount: toNumber(draft.requested_amount, 0),
        purpose: draft.purpose.trim(),
        request_note: draft.request_note.trim(),
        ...(canManage && draft.employee_id
          ? { employee_id: draft.employee_id }
          : {}),
      };

      const data = await api(
        editingId
          ? `/payroll/loans/${encodeURIComponent(editingId)}`
          : '/payroll/loans',
        {
          method: editingId ? 'PATCH' : 'POST',
          body: JSON.stringify(payload),
        },
      );

      const saved = data.loan_advance;

      alerts.success(
        data.message ||
          (editingId
            ? 'Draft updated successfully.'
            : 'Draft created successfully.'),
        editingId ? 'Draft Updated' : 'Draft Created',
      );

      closeDraftForm(true);
      await refreshAll({
        silent: true,
        preferredId: recordId(saved),
      });
      await loadDetail(recordId(saved), { silent: true });
    } catch (error) {
      alerts.error(
        error.message || 'Unable to save the loan or advance draft.',
        'Draft Save Failed',
      );
    } finally {
      setSaving(false);
    }
  }

  async function submitRecord(record) {
    const id = recordId(record);

    if (!id || !assertTenant()) {
      return;
    }

    const confirmed = await alerts.confirm(
      `Submit ${safeText(record.label, loanTypeLabel(record.type))} for Finance approval? The draft cannot be edited after submission.`,
      {
        title: 'Submit Loan or Advance',
        confirmText: 'Submit for Approval',
        cancelText: 'Keep Draft',
      },
    );

    if (!confirmed) {
      return;
    }

    try {
      setActionLoading(`submit-${id}`);

      const data = await api(
        `/payroll/loans/${encodeURIComponent(id)}/submit`,
        {
          method: 'POST',
          body: JSON.stringify({
            ...tenantParams(),
            note: 'Submitted for approval.',
          }),
        },
      );

      alerts.success(
        data.message || 'Request submitted successfully.',
        'Request Submitted',
      );
      await refreshAll({
        silent: true,
        preferredId: id,
      });
      await loadDetail(id, { silent: true });
    } catch (error) {
      alerts.error(
        error.message || 'Unable to submit the request.',
        'Submission Failed',
      );
    } finally {
      setActionLoading('');
    }
  }

  function openAction(action, record) {
    const existingInstallments =
      action === 'recovery'
        ? latestRecoveryRevision(record)?.custom_installments ||
          record.custom_installments ||
          []
        : record.custom_installments || [];

    const existingHolds =
      action === 'recovery'
        ? latestRecoveryRevision(record)?.hold_periods ||
          record.hold_periods ||
          []
        : record.hold_periods || [];

    setActionRecord(record);
    setActionForm({
      ...emptyActionForm(),
      approved_amount: safeText(
        record.approved_amount || record.requested_amount,
        '',
      ),
      interest_amount: safeText(record.interest_amount, '0'),
      emi_amount: safeText(
        latestRecoveryRevision(record)?.emi_amount ||
          record.emi_amount ||
          record.deduction_amount,
        '',
      ),
      recovery_start_period: safeText(record.recovery_start_period, ''),
      recovery_end_period: safeText(
        latestRecoveryRevision(record)?.recovery_end_period ||
          record.recovery_end_period,
        '',
      ),
      hold_periods: (existingHolds || []).join(', '),
      custom_installments: normalizeInstallmentRows(existingInstallments),
    });
    setActionModal(action);
  }

  function closeAction(force = false) {
    if (actionLoading && !force) {
      return;
    }

    setActionModal('');
    setActionRecord(null);
    setActionForm(emptyActionForm());
  }

  function updateActionField(field, value) {
    setActionForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function addInstallmentRow() {
    setActionForm((current) => ({
      ...current,
      custom_installments: [
        ...current.custom_installments,
        {
          period_key: '',
          amount: '',
          status: 'scheduled',
          note: '',
        },
      ],
    }));
  }

  function updateInstallmentRow(index, field, value) {
    setActionForm((current) => ({
      ...current,
      custom_installments: current.custom_installments.map((row, rowIndex) =>
        rowIndex === index
          ? {
              ...row,
              [field]: value,
            }
          : row,
      ),
    }));
  }

  function removeInstallmentRow(index) {
    setActionForm((current) => ({
      ...current,
      custom_installments: current.custom_installments.filter(
        (_, rowIndex) => rowIndex !== index,
      ),
    }));
  }

  function normalizedInstallments() {
    return actionForm.custom_installments
      .filter(
        (row) =>
          row.period_key ||
          row.amount ||
          row.note,
      )
      .map((row) => ({
        period_key: row.period_key,
        amount: toNumber(row.amount, 0),
        status: row.status || 'scheduled',
        note: row.note.trim(),
      }));
  }

  function validateAction() {
    if (actionModal === 'approve') {
      if (toNumber(actionForm.approved_amount, 0) <= 0) {
        return 'Approved amount must be greater than zero.';
      }

      if (toNumber(actionForm.interest_amount, 0) < 0) {
        return 'Interest amount cannot be negative.';
      }

      if (toNumber(actionForm.emi_amount, 0) <= 0) {
        return 'Monthly EMI must be greater than zero.';
      }

      if (!actionForm.recovery_start_period) {
        return 'Select the payroll month from which recovery begins.';
      }
    }

    if (actionModal === 'reject' || actionModal === 'cancel') {
      if (!actionForm.reason.trim()) {
        return actionModal === 'reject'
          ? 'Enter a rejection reason.'
          : 'Enter a cancellation reason.';
      }
    }

    if (actionModal === 'disburse') {
      if (!actionForm.transfer_date) {
        return 'Enter the transfer date.';
      }

      if (!actionForm.transfer_mode) {
        return 'Select the transfer mode.';
      }
    }

    if (actionModal === 'recovery') {
      if (!actionForm.effective_from_period) {
        return 'Select the future payroll month from which revised terms apply.';
      }

      if (toNumber(actionForm.emi_amount, 0) <= 0) {
        return 'Revised EMI must be greater than zero.';
      }
    }

    const installments = actionForm.custom_installments.filter(
      (row) => row.period_key || row.amount || row.note,
    );

    for (const row of installments) {
      if (!row.period_key) {
        return 'Every custom installment must contain a payroll month.';
      }

      if (toNumber(row.amount, -1) < 0) {
        return 'Custom installment amounts cannot be negative.';
      }
    }

    return '';
  }

  async function executeAction(event) {
    event.preventDefault();

    const id = recordId(actionRecord);
    const validationMessage = validateAction();

    if (!id || !assertTenant()) {
      return;
    }

    if (validationMessage) {
      alerts.warning(validationMessage, 'Action Details Required');
      return;
    }

    const confirmed = await alerts.confirm(
      `Continue with “${actionTitle(actionModal)}” for ${safeText(
        actionRecord.employee_name,
        'this employee',
      )}?`,
      {
        title: actionTitle(actionModal),
        confirmText:
          actionModal === 'reject' || actionModal === 'cancel'
            ? 'Yes, Continue'
            : 'Confirm Action',
        cancelText: 'Go Back',
        danger: actionModal === 'reject' || actionModal === 'cancel',
      },
    );

    if (!confirmed) {
      return;
    }

    let endpoint = '';
    let payload = {
      ...tenantParams(),
    };

    if (actionModal === 'approve') {
      endpoint = 'approve';
      payload = {
        ...payload,
        approved_amount: toNumber(actionForm.approved_amount, 0),
        interest_amount: toNumber(actionForm.interest_amount, 0),
        emi_amount: toNumber(actionForm.emi_amount, 0),
        recovery_start_period: actionForm.recovery_start_period,
        recovery_end_period: actionForm.recovery_end_period,
        hold_periods: parseCommaPeriods(actionForm.hold_periods),
        custom_installments: normalizedInstallments(),
        note: actionForm.note.trim(),
      };
    } else if (actionModal === 'reject') {
      endpoint = 'reject';
      payload = {
        ...payload,
        reason: actionForm.reason.trim(),
      };
    } else if (actionModal === 'disburse') {
      endpoint = 'disburse';
      payload = {
        ...payload,
        note: actionForm.note.trim(),
        disbursement: {
          transfer_date: actionForm.transfer_date,
          transfer_mode: actionForm.transfer_mode,
          transaction_reference: actionForm.transaction_reference.trim(),
          bank_reference: actionForm.bank_reference.trim(),
          note: actionForm.note.trim(),
        },
      };
    } else if (actionModal === 'cancel') {
      endpoint = 'cancel';
      payload = {
        ...payload,
        reason: actionForm.reason.trim(),
      };
    } else if (actionModal === 'recovery') {
      endpoint = 'recovery-terms';
      payload = {
        ...payload,
        effective_from_period: actionForm.effective_from_period,
        emi_amount: toNumber(actionForm.emi_amount, 0),
        recovery_end_period: actionForm.recovery_end_period,
        hold_periods: parseCommaPeriods(actionForm.hold_periods),
        custom_installments: normalizedInstallments(),
        note: actionForm.note.trim(),
      };
    }

    try {
      setActionLoading(`${actionModal}-${id}`);

      const data = await api(
        `/payroll/loans/${encodeURIComponent(id)}/${endpoint}`,
        {
          method: 'POST',
          body: JSON.stringify(payload),
        },
      );

      alerts.success(
        data.message || 'Loan or advance updated successfully.',
        'Action Completed',
      );
      closeAction(true);
      await refreshAll({
        silent: true,
        preferredId: id,
      });
      await loadDetail(id, { silent: true });
    } catch (error) {
      alerts.error(
        error.message || 'Unable to complete the loan or advance action.',
        'Action Failed',
      );
    } finally {
      setActionLoading('');
    }
  }

  function renderActionButtons(record, compact = false) {
    const id = recordId(record);
    const status = normalizeKey(record.status);
    const busy = Boolean(actionLoading);
    const submitBusy = actionLoading === `submit-${id}`;

    return (
      <div
        className={`la-action-buttons ${compact ? 'is-compact' : ''}`}
        onClick={(event) => event.stopPropagation()}
      >
        {status === 'draft' ? (
          <>
            <button
              type="button"
              className="la-btn la-btn-secondary"
              onClick={() => openEdit(record)}
              disabled={busy}
            >
              <FilePenLine size={15} />
              Edit
            </button>

            <button
              type="button"
              className="la-btn la-btn-primary"
              onClick={() => submitRecord(record)}
              disabled={busy}
            >
              {submitBusy ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <Send size={15} />
              )}
              Submit
            </button>
          </>
        ) : null}

        {status === 'pending_approval' && canFinanceAct ? (
          <>
            <button
              type="button"
              className="la-btn la-btn-success"
              onClick={() => openAction('approve', record)}
              disabled={busy}
            >
              <CheckCircle2 size={15} />
              Approve
            </button>

            <button
              type="button"
              className="la-btn la-btn-danger"
              onClick={() => openAction('reject', record)}
              disabled={busy}
            >
              <XCircle size={15} />
              Reject
            </button>
          </>
        ) : null}

        {status === 'approved' && canFinanceAct ? (
          <button
            type="button"
            className="la-btn la-btn-primary"
            onClick={() => openAction('disburse', record)}
            disabled={busy}
          >
            <Landmark size={15} />
            Disburse
          </button>
        ) : null}

        {RECOVERY_STATUSES.has(status) && canFinanceAct ? (
          <button
            type="button"
            className="la-btn la-btn-secondary"
            onClick={() => openAction('recovery', record)}
            disabled={busy}
          >
            <SlidersHorizontal size={15} />
            Revise EMI
          </button>
        ) : null}

        {CANCELLABLE_STATUSES.has(status) ? (
          <button
            type="button"
            className="la-btn la-btn-ghost-danger"
            onClick={() => openAction('cancel', record)}
            disabled={busy}
          >
            <Ban size={15} />
            Cancel
          </button>
        ) : null}
      </div>
    );
  }

  const selectedStatus = normalizeKey(selectedRecord?.status);

  return (
    <div className="loans-advances-page">
      <style>{`
        .loans-advances-page {
          display: grid;
          gap: 18px;
          min-width: 0;
          color: var(--text, #172033);
        }

        .loans-advances-page * {
          box-sizing: border-box;
        }

        .la-panel {
          min-width: 0;
          padding: 20px;
          border: 1px solid var(--border, #dfe5ee);
          border-radius: 18px;
          background: var(--card, #ffffff);
          box-shadow: 0 12px 32px rgba(15, 23, 42, 0.06);
        }

        .la-hero {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 20px;
          overflow: hidden;
          position: relative;
          padding: 24px;
          border: 1px solid rgba(51, 85, 255, 0.18);
          border-radius: 22px;
          background:
            radial-gradient(circle at 90% 10%, rgba(64, 97, 255, 0.16), transparent 34%),
            linear-gradient(135deg, rgba(247, 249, 255, 0.98), rgba(255, 255, 255, 0.98));
        }

        .la-hero::after {
          position: absolute;
          right: -40px;
          bottom: -65px;
          width: 190px;
          height: 190px;
          border-radius: 50%;
          background: rgba(67, 97, 238, 0.07);
          content: '';
        }

        .la-hero-content,
        .la-hero-actions {
          position: relative;
          z-index: 1;
        }

        .la-kicker {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          margin-bottom: 8px;
          color: #4056d6;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .la-hero h1 {
          margin: 0 0 8px;
          font-size: clamp(25px, 3vw, 36px);
          line-height: 1.1;
        }

        .la-hero p {
          max-width: 770px;
          margin: 0;
          color: var(--muted, #64748b);
          line-height: 1.65;
        }

        .la-hero-actions {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 10px;
        }

        .la-btn {
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

        .la-btn:hover:not(:disabled) {
          transform: translateY(-1px);
        }

        .la-btn:disabled {
          cursor: not-allowed;
          opacity: 0.55;
        }

        .la-btn-primary {
          color: #fff;
          background: #4056d6;
          border-color: #4056d6;
        }

        .la-btn-success {
          color: #fff;
          background: #07875f;
          border-color: #07875f;
        }

        .la-btn-danger {
          color: #fff;
          background: #c9364b;
          border-color: #c9364b;
        }

        .la-btn-secondary {
          color: #27324a;
          background: #fff;
          border-color: var(--border, #dfe5ee);
        }

        .la-btn-ghost-danger {
          color: #b4233a;
          background: rgba(201, 54, 75, 0.06);
          border-color: rgba(201, 54, 75, 0.18);
        }

        .la-metrics {
          display: grid;
          grid-template-columns: repeat(5, minmax(150px, 1fr));
          gap: 13px;
        }

        .la-metric {
          min-width: 0;
          padding: 17px;
          border: 1px solid var(--border, #dfe5ee);
          border-radius: 16px;
          background: var(--card, #fff);
        }

        .la-metric-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 10px;
          color: var(--muted, #64748b);
          font-size: 12px;
          font-weight: 850;
          text-transform: uppercase;
        }

        .la-metric strong {
          display: block;
          overflow: hidden;
          font-size: clamp(22px, 2.5vw, 30px);
          line-height: 1.15;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .la-toolbar {
          display: grid;
          grid-template-columns: minmax(220px, 1.4fr) repeat(3, minmax(160px, 0.7fr));
          gap: 12px;
          align-items: end;
        }

        .la-field {
          display: grid;
          gap: 7px;
          min-width: 0;
        }

        .la-field label {
          color: #465269;
          font-size: 12px;
          font-weight: 850;
        }

        .la-field input,
        .la-field select,
        .la-field textarea {
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

        .la-field textarea {
          min-height: 92px;
          resize: vertical;
          line-height: 1.5;
        }

        .la-field input:focus,
        .la-field select:focus,
        .la-field textarea:focus {
          border-color: #566be0;
          box-shadow: 0 0 0 3px rgba(64, 86, 214, 0.11);
        }

        .la-search-wrap {
          position: relative;
        }

        .la-search-wrap svg {
          position: absolute;
          top: 50%;
          left: 12px;
          color: #8a96aa;
          transform: translateY(-50%);
          pointer-events: none;
        }

        .la-search-wrap input {
          padding-left: 38px;
        }

        .la-main-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.3fr) minmax(330px, 0.7fr);
          gap: 18px;
          align-items: start;
        }

        .la-section-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          margin-bottom: 16px;
        }

        .la-section-head h2,
        .la-section-head h3 {
          margin: 0 0 5px;
          font-size: 19px;
        }

        .la-section-head p {
          margin: 0;
          color: var(--muted, #64748b);
          font-size: 13px;
          line-height: 1.5;
        }

        .la-record-list {
          display: grid;
          gap: 11px;
        }

        .la-record {
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

        .la-record:hover {
          border-color: rgba(64, 86, 214, 0.45);
          box-shadow: 0 10px 26px rgba(35, 48, 80, 0.08);
          transform: translateY(-1px);
        }

        .la-record.is-selected {
          border-color: #4056d6;
          box-shadow: 0 0 0 3px rgba(64, 86, 214, 0.1);
        }

        .la-record-title {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
          margin-bottom: 7px;
        }

        .la-record-title strong {
          min-width: 0;
          font-size: 15px;
        }

        .la-record-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 7px 14px;
          color: var(--muted, #64748b);
          font-size: 12px;
        }

        .la-record-meta span {
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }

        .la-record-amount {
          text-align: right;
        }

        .la-record-amount strong {
          display: block;
          margin-bottom: 5px;
          font-size: 17px;
        }

        .la-record-amount small {
          color: var(--muted, #64748b);
          font-weight: 700;
        }

        .la-status {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 5px 9px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 900;
          white-space: nowrap;
        }

        .la-status-success {
          color: #047857;
          background: rgba(5, 150, 105, 0.1);
        }

        .la-status-info {
          color: #1d4ed8;
          background: rgba(37, 99, 235, 0.1);
        }

        .la-status-danger {
          color: #b4233a;
          background: rgba(201, 54, 75, 0.1);
        }

        .la-status-warning {
          color: #9a5b00;
          background: rgba(245, 158, 11, 0.13);
        }

        .la-empty {
          display: grid;
          place-items: center;
          min-height: 220px;
          padding: 30px;
          border: 1px dashed var(--border, #d7dee9);
          border-radius: 15px;
          color: var(--muted, #64748b);
          text-align: center;
        }

        .la-empty svg {
          margin-bottom: 10px;
          opacity: 0.6;
        }

        .la-detail {
          position: sticky;
          top: 18px;
          min-width: 0;
        }

        .la-detail-identity {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          padding-bottom: 15px;
          border-bottom: 1px solid var(--border, #e3e7ef);
        }

        .la-detail-identity h2 {
          margin: 0 0 5px;
          font-size: 20px;
        }

        .la-detail-identity p {
          margin: 0;
          color: var(--muted, #64748b);
          font-size: 13px;
        }

        .la-detail-stats {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin: 15px 0;
        }

        .la-detail-stat {
          min-width: 0;
          padding: 12px;
          border-radius: 12px;
          background: rgba(148, 163, 184, 0.09);
        }

        .la-detail-stat span {
          display: block;
          margin-bottom: 4px;
          color: var(--muted, #64748b);
          font-size: 11px;
          font-weight: 850;
          text-transform: uppercase;
        }

        .la-detail-stat strong {
          display: block;
          overflow: hidden;
          font-size: 15px;
          text-overflow: ellipsis;
        }

        .la-note {
          padding: 12px 13px;
          border-left: 3px solid #6072dd;
          border-radius: 8px;
          background: rgba(64, 86, 214, 0.06);
          color: #3d4961;
          font-size: 13px;
          line-height: 1.55;
        }

        .la-action-buttons {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 15px;
        }

        .la-action-buttons.is-compact {
          justify-content: flex-end;
          margin-top: 10px;
        }

        .la-action-buttons.is-compact .la-btn {
          min-height: 34px;
          padding: 7px 10px;
          font-size: 12px;
        }

        .la-accordion {
          margin-top: 14px;
          border: 1px solid var(--border, #dfe5ee);
          border-radius: 13px;
          overflow: hidden;
        }

        .la-accordion-button {
          display: flex;
          width: 100%;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 12px 13px;
          border: 0;
          background: rgba(148, 163, 184, 0.07);
          color: inherit;
          font: inherit;
          font-size: 13px;
          font-weight: 850;
          cursor: pointer;
        }

        .la-timeline {
          display: grid;
          gap: 0;
          max-height: 320px;
          overflow: auto;
          padding: 4px 14px 12px;
        }

        .la-timeline-item {
          position: relative;
          padding: 11px 0 11px 20px;
          border-bottom: 1px solid rgba(226, 232, 240, 0.9);
        }

        .la-timeline-item:last-child {
          border-bottom: 0;
        }

        .la-timeline-item::before {
          position: absolute;
          top: 17px;
          left: 2px;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #5266d7;
          content: '';
        }

        .la-timeline-item strong {
          display: block;
          margin-bottom: 3px;
          font-size: 12px;
        }

        .la-timeline-item p,
        .la-timeline-item small {
          display: block;
          margin: 0;
          color: var(--muted, #64748b);
          font-size: 11px;
          line-height: 1.45;
        }

        .la-modal-backdrop {
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

        .la-modal {
          width: min(760px, 100%);
          max-height: calc(100vh - 44px);
          overflow: auto;
          border: 1px solid rgba(255, 255, 255, 0.35);
          border-radius: 20px;
          background: #fff;
          box-shadow: 0 30px 90px rgba(15, 23, 42, 0.3);
        }

        .la-modal-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          padding: 20px 22px 14px;
          border-bottom: 1px solid #e4e8ef;
        }

        .la-modal-head h2 {
          margin: 0 0 4px;
          font-size: 21px;
        }

        .la-modal-head p {
          margin: 0;
          color: #64748b;
          font-size: 13px;
        }

        .la-modal-close {
          width: 38px;
          height: 38px;
          border: 1px solid #dfe5ee;
          border-radius: 10px;
          background: #fff;
          color: #334155;
          cursor: pointer;
        }

        .la-modal-body {
          display: grid;
          gap: 15px;
          padding: 20px 22px;
        }

        .la-form-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 13px;
        }

        .la-field-full {
          grid-column: 1 / -1;
        }

        .la-modal-actions {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 10px;
          padding: 14px 22px 20px;
          border-top: 1px solid #e4e8ef;
        }

        .la-installments {
          display: grid;
          gap: 9px;
          padding: 13px;
          border: 1px solid #e1e6ef;
          border-radius: 13px;
          background: #fafbfe;
        }

        .la-installments-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .la-installments-head strong {
          font-size: 13px;
        }

        .la-installment-row {
          display: grid;
          grid-template-columns: minmax(130px, 0.8fr) minmax(110px, 0.7fr) minmax(120px, 0.7fr) minmax(150px, 1fr) auto;
          gap: 8px;
          align-items: end;
        }

        .la-installment-row input,
        .la-installment-row select {
          width: 100%;
          min-height: 38px;
          padding: 8px 9px;
          border: 1px solid #d7dee9;
          border-radius: 9px;
          background: #fff;
          font: inherit;
          font-size: 12px;
        }

        .la-icon-btn {
          display: inline-grid;
          width: 38px;
          height: 38px;
          place-items: center;
          border: 1px solid rgba(201, 54, 75, 0.2);
          border-radius: 9px;
          background: rgba(201, 54, 75, 0.06);
          color: #b4233a;
          cursor: pointer;
        }

        .la-warning {
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

        .spin {
          animation: la-spin 0.9s linear infinite;
        }

        @keyframes la-spin {
          to {
            transform: rotate(360deg);
          }
        }

        @media (max-width: 1180px) {
          .la-metrics {
            grid-template-columns: repeat(3, minmax(150px, 1fr));
          }

          .la-toolbar {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .la-main-grid {
            grid-template-columns: 1fr;
          }

          .la-detail {
            position: static;
          }
        }

        @media (max-width: 760px) {
          .la-hero {
            flex-direction: column;
            padding: 20px;
          }

          .la-hero-actions {
            width: 100%;
            justify-content: stretch;
          }

          .la-hero-actions .la-btn {
            flex: 1;
          }

          .la-metrics,
          .la-toolbar,
          .la-form-grid {
            grid-template-columns: 1fr;
          }

          .la-record {
            grid-template-columns: 1fr;
          }

          .la-record-amount {
            text-align: left;
          }

          .la-action-buttons.is-compact {
            justify-content: flex-start;
          }

          .la-installment-row {
            grid-template-columns: 1fr;
            padding: 10px;
            border: 1px solid #e2e7ef;
            border-radius: 10px;
            background: #fff;
          }

          .la-modal-backdrop {
            align-items: end;
            padding: 0;
          }

          .la-modal {
            max-height: 94vh;
            border-radius: 20px 20px 0 0;
          }

          .la-modal-head,
          .la-modal-body,
          .la-modal-actions {
            padding-left: 16px;
            padding-right: 16px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .loans-advances-page *,
          .loans-advances-page *::before,
          .loans-advances-page *::after {
            scroll-behavior: auto !important;
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
          }
        }
      `}</style>

      <header className="la-hero">
        <div className="la-hero-content">
          <span className="la-kicker">
            <WalletCards size={15} />
            Payroll Recovery
          </span>
          <h1>Loans & Advances</h1>
          <p>
            Manage employee requests, Finance approval, disbursement and immutable
            payroll recovery. A loan is deducted only after it is disbursed, and the
            final deduction never exceeds the remaining balance.
          </p>
        </div>

        <div className="la-hero-actions">
          <button
            type="button"
            className="la-btn la-btn-secondary"
            onClick={() => refreshAll()}
            disabled={loading || loadingEmployees}
          >
            {loading ? (
              <Loader2 size={17} className="spin" />
            ) : (
              <RefreshCw size={17} />
            )}
            Refresh
          </button>

          <button
            type="button"
            className="la-btn la-btn-primary"
            onClick={openCreate}
          >
            <Plus size={17} />
            New Request
          </button>
        </div>
      </header>

      <section className="la-metrics">
        <article className="la-metric">
          <div className="la-metric-head">
            <span>Total records</span>
            <WalletCards size={17} />
          </div>
          <strong>{metrics.total}</strong>
        </article>

        <article className="la-metric">
          <div className="la-metric-head">
            <span>Pending approval</span>
            <Clock3 size={17} />
          </div>
          <strong>{metrics.pending}</strong>
        </article>

        <article className="la-metric">
          <div className="la-metric-head">
            <span>Active recovery</span>
            <CircleDollarSign size={17} />
          </div>
          <strong>{metrics.active}</strong>
        </article>

        <article className="la-metric">
          <div className="la-metric-head">
            <span>Outstanding</span>
            <IndianRupee size={17} />
          </div>
          <strong>{formatCurrency(metrics.outstanding)}</strong>
        </article>

        <article className="la-metric">
          <div className="la-metric-head">
            <span>Total recovered</span>
            <CheckCircle2 size={17} />
          </div>
          <strong>{formatCurrency(metrics.recovered)}</strong>
        </article>
      </section>

      <section className="la-panel">
        <div className="la-toolbar">
          <div className="la-field">
            <label htmlFor="loan-search">Search records</label>
            <div className="la-search-wrap">
              <Search size={16} />
              <input
                id="loan-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Employee, code, type, purpose or status"
              />
            </div>
          </div>

          <div className="la-field">
            <label htmlFor="loan-status-filter">Status</label>
            <select
              id="loan-status-filter"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              {FILTER_STATUSES.map(([value, label]) => (
                <option key={value || 'all'} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="la-field">
            <label htmlFor="loan-type-filter">Type</label>
            <select
              id="loan-type-filter"
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
            >
              <option value="">All types</option>
              {LOAN_TYPES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {canManage ? (
            <div className="la-field">
              <label htmlFor="loan-employee-filter">Employee</label>
              <select
                id="loan-employee-filter"
                value={employeeFilter}
                onChange={(event) => setEmployeeFilter(event.target.value)}
                disabled={loadingEmployees}
              >
                <option value="">All employees</option>
                {employees.map((employee) => (
                  <option key={employeeId(employee)} value={employeeId(employee)}>
                    {employeeName(employee)} ({employeeCode(employee)})
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {superAdmin ? (
            <div className="la-field">
              <label htmlFor="loan-tenant-id">Company tenant ID</label>
              <input
                id="loan-tenant-id"
                type="text"
                value={tenantId}
                onChange={(event) => setTenantId(event.target.value)}
                placeholder="Example: sds"
              />
            </div>
          ) : null}
        </div>
      </section>

      <div className="la-main-grid">
        <section className="la-panel">
          <div className="la-section-head">
            <div>
              <h2>Requests and Recoveries</h2>
              <p>
                {filteredItems.length} matching record
                {filteredItems.length === 1 ? '' : 's'}
              </p>
            </div>

            {loading ? <Loader2 size={20} className="spin" /> : null}
          </div>

          {filteredItems.length ? (
            <div className="la-record-list">
              {filteredItems.map((record) => {
                const id = recordId(record);
                const selected = id && id === recordId(selectedRecord);
                const amount = getRecordAmount(record);

                return (
                  <article
                    className={`la-record ${selected ? 'is-selected' : ''}`}
                    key={id}
                    role="button"
                    tabIndex={0}
                    onClick={() => loadDetail(id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        loadDetail(id);
                      }
                    }}
                  >
                    <div>
                      <div className="la-record-title">
                        <strong>
                          {safeText(record.label, loanTypeLabel(record.type))}
                        </strong>
                        <span
                          className={`la-status la-status-${statusTone(record.status)}`}
                        >
                          {labelFromKey(record.status)}
                        </span>
                      </div>

                      <div className="la-record-meta">
                        <span>
                          <UserRound size={13} />
                          {safeText(record.employee_name, 'Employee')}
                          {record.employee_code
                            ? ` (${record.employee_code})`
                            : ''}
                        </span>
                        <span>
                          <Banknote size={13} />
                          {loanTypeLabel(record.type)}
                        </span>
                        <span>
                          <CalendarDays size={13} />
                          {formatDate(record.created_at, false)}
                        </span>
                      </div>

                      {renderActionButtons(record, true)}
                    </div>

                    <div className="la-record-amount">
                      <strong>{formatCurrency(amount)}</strong>
                      <small>
                        Balance: {formatCurrency(remainingBalance(record))}
                      </small>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="la-empty">
              <div>
                <WalletCards size={34} />
                <strong>No loan or advance records found</strong>
                <p>
                  Create a new request or change the selected filters.
                </p>
              </div>
            </div>
          )}
        </section>

        <aside className="la-panel la-detail">
          {loadingDetail ? (
            <div className="la-empty">
              <div>
                <Loader2 size={30} className="spin" />
                <strong>Loading details…</strong>
              </div>
            </div>
          ) : selectedRecord ? (
            <>
              <div className="la-detail-identity">
                <div>
                  <h2>
                    {safeText(
                      selectedRecord.label,
                      loanTypeLabel(selectedRecord.type),
                    )}
                  </h2>
                  <p>
                    {safeText(selectedRecord.employee_name, 'Employee')}
                    {selectedRecord.employee_code
                      ? ` · ${selectedRecord.employee_code}`
                      : ''}
                  </p>
                </div>

                <span
                  className={`la-status la-status-${statusTone(
                    selectedRecord.status,
                  )}`}
                >
                  {labelFromKey(selectedRecord.status)}
                </span>
              </div>

              <div className="la-detail-stats">
                <article className="la-detail-stat">
                  <span>Requested</span>
                  <strong>
                    {formatCurrency(selectedRecord.requested_amount)}
                  </strong>
                </article>
                <article className="la-detail-stat">
                  <span>Approved</span>
                  <strong>
                    {formatCurrency(selectedRecord.approved_amount)}
                  </strong>
                </article>
                <article className="la-detail-stat">
                  <span>Monthly EMI</span>
                  <strong>
                    {formatCurrency(
                      latestRecoveryRevision(selectedRecord)?.emi_amount ||
                        selectedRecord.emi_amount,
                    )}
                  </strong>
                </article>
                <article className="la-detail-stat">
                  <span>Remaining</span>
                  <strong>
                    {formatCurrency(remainingBalance(selectedRecord))}
                  </strong>
                </article>
                <article className="la-detail-stat">
                  <span>Recovered</span>
                  <strong>
                    {formatCurrency(recoveredAmount(selectedRecord))}
                  </strong>
                </article>
                <article className="la-detail-stat">
                  <span>Recovery starts</span>
                  <strong>
                    {safeText(selectedRecord.recovery_start_period)}
                  </strong>
                </article>
              </div>

              <div className="la-detail-stats">
                <article className="la-detail-stat">
                  <span>Type</span>
                  <strong>{loanTypeLabel(selectedRecord.type)}</strong>
                </article>
                <article className="la-detail-stat">
                  <span>Interest amount</span>
                  <strong>
                    {formatCurrency(selectedRecord.interest_amount)}
                  </strong>
                </article>
                <article className="la-detail-stat">
                  <span>Recoverable</span>
                  <strong>
                    {formatCurrency(selectedRecord.recoverable_amount)}
                  </strong>
                </article>
                <article className="la-detail-stat">
                  <span>Recovery end</span>
                  <strong>
                    {safeText(
                      latestRecoveryRevision(selectedRecord)?.recovery_end_period ||
                        selectedRecord.recovery_end_period,
                    )}
                  </strong>
                </article>
              </div>

              {selectedRecord.purpose ? (
                <div className="la-note">
                  <strong>Purpose:</strong> {selectedRecord.purpose}
                </div>
              ) : null}

              {selectedRecord.request_note ? (
                <div className="la-note" style={{ marginTop: 10 }}>
                  <strong>Request note:</strong> {selectedRecord.request_note}
                </div>
              ) : null}

              {selectedStatus === 'rejected' ? (
                <div className="la-warning" style={{ marginTop: 12 }}>
                  <AlertTriangle size={17} />
                  <span>
                    <strong>Rejected:</strong>{' '}
                    {safeText(selectedRecord.rejection?.reason)}
                  </span>
                </div>
              ) : null}

              {selectedStatus === 'cancelled' ? (
                <div className="la-warning" style={{ marginTop: 12 }}>
                  <Ban size={17} />
                  <span>
                    <strong>Cancelled:</strong>{' '}
                    {safeText(selectedRecord.cancellation_reason)}
                  </span>
                </div>
              ) : null}

              {selectedRecord.disbursement?.transfer_date ? (
                <div className="la-note" style={{ marginTop: 12 }}>
                  <strong>Disbursement:</strong>{' '}
                  {formatCurrency(selectedRecord.approved_amount)} via{' '}
                  {safeText(selectedRecord.disbursement.transfer_mode)} on{' '}
                  {formatDate(
                    selectedRecord.disbursement.transfer_date,
                    false,
                  )}
                  {selectedRecord.disbursement.transaction_reference
                    ? ` · Ref: ${selectedRecord.disbursement.transaction_reference}`
                    : ''}
                </div>
              ) : null}

              {renderActionButtons(selectedRecord)}

              <div className="la-accordion">
                <button
                  type="button"
                  className="la-accordion-button"
                  onClick={() => setShowWorkflow((current) => !current)}
                >
                  <span>
                    <History size={15} /> Workflow history
                  </span>
                  {showWorkflow ? (
                    <ChevronUp size={16} />
                  ) : (
                    <ChevronDown size={16} />
                  )}
                </button>

                {showWorkflow ? (
                  <div className="la-timeline">
                    {workflowHistory(selectedRecord).length ? (
                      workflowHistory(selectedRecord).map((entry, index) => (
                        <article
                          className="la-timeline-item"
                          key={`${safeText(entry.at, index)}-${index}`}
                        >
                          <strong>
                            {labelFromKey(entry.action || entry.to_status)}
                          </strong>
                          <p>
                            {safeText(entry.actor_name, 'System')} ·{' '}
                            {formatDate(entry.at)}
                          </p>
                          {entry.note ? <small>{entry.note}</small> : null}
                        </article>
                      ))
                    ) : (
                      <div className="la-empty" style={{ minHeight: 100 }}>
                        No workflow history available.
                      </div>
                    )}
                  </div>
                ) : null}
              </div>

              <div className="la-accordion">
                <button
                  type="button"
                  className="la-accordion-button"
                  onClick={() => setShowRecoveries((current) => !current)}
                >
                  <span>
                    <CreditCard size={15} /> Payroll recovery history
                  </span>
                  {showRecoveries ? (
                    <ChevronUp size={16} />
                  ) : (
                    <ChevronDown size={16} />
                  )}
                </button>

                {showRecoveries ? (
                  <div className="la-timeline">
                    {recoveryHistory(selectedRecord).length ? (
                      recoveryHistory(selectedRecord).map((entry, index) => (
                        <article
                          className="la-timeline-item"
                          key={`${safeText(entry.run_id, index)}-${index}`}
                        >
                          <strong>
                            {formatCurrency(entry.deduction_amount)} ·{' '}
                            {safeText(entry.period_key)}
                          </strong>
                          <p>
                            Balance: {formatCurrency(entry.balance_before)} →{' '}
                            {formatCurrency(entry.balance_after)}
                          </p>
                          <small>
                            Applied {formatDate(entry.applied_at)}
                          </small>
                        </article>
                      ))
                    ) : (
                      <div className="la-empty" style={{ minHeight: 100 }}>
                        No payroll recovery has been applied yet.
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <div className="la-empty">
              <div>
                <UserRound size={34} />
                <strong>Select a record</strong>
                <p>
                  Open a request to view approval, disbursement and recovery details.
                </p>
              </div>
            </div>
          )}
        </aside>
      </div>

      {showDraftForm ? (
        <div className="la-modal-backdrop" role="presentation">
          <div
            className="la-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="loan-draft-title"
          >
            <div className="la-modal-head">
              <div>
                <h2 id="loan-draft-title">
                  {editingRecord
                    ? 'Edit Loan or Advance Draft'
                    : 'Create Loan or Advance Draft'}
                </h2>
                <p>
                  Drafts remain editable until they are submitted for approval.
                </p>
              </div>

              <button
                type="button"
                className="la-modal-close"
                onClick={closeDraftForm}
                aria-label="Close"
                disabled={saving}
              >
                ×
              </button>
            </div>

            <form onSubmit={saveDraft}>
              <div className="la-modal-body">
                <div className="la-form-grid">
                  {canManage ? (
                    <div className="la-field la-field-full">
                      <label htmlFor="loan-draft-employee">Employee *</label>
                      <select
                        id="loan-draft-employee"
                        value={draft.employee_id}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            employee_id: event.target.value,
                          }))
                        }
                        disabled={Boolean(editingRecord) || loadingEmployees}
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

                  <div className="la-field">
                    <label htmlFor="loan-draft-type">Type *</label>
                    <select
                      id="loan-draft-type"
                      value={draft.type}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          type: event.target.value,
                        }))
                      }
                      required
                    >
                      {LOAN_TYPES.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="la-field">
                    <label htmlFor="loan-draft-amount">
                      Requested amount *
                    </label>
                    <input
                      id="loan-draft-amount"
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={draft.requested_amount}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          requested_amount: event.target.value,
                        }))
                      }
                      placeholder="0.00"
                      required
                    />
                  </div>

                  <div className="la-field la-field-full">
                    <label htmlFor="loan-draft-label">
                      Custom label (optional)
                    </label>
                    <input
                      id="loan-draft-label"
                      type="text"
                      maxLength={120}
                      value={draft.label}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          label: event.target.value,
                        }))
                      }
                      placeholder="Example: Emergency Personal Advance"
                    />
                  </div>

                  <div className="la-field la-field-full">
                    <label htmlFor="loan-draft-purpose">Purpose *</label>
                    <textarea
                      id="loan-draft-purpose"
                      value={draft.purpose}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          purpose: event.target.value,
                        }))
                      }
                      placeholder="Explain why this loan or advance is required."
                      required
                    />
                  </div>

                  <div className="la-field la-field-full">
                    <label htmlFor="loan-draft-note">Additional note</label>
                    <textarea
                      id="loan-draft-note"
                      value={draft.request_note}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          request_note: event.target.value,
                        }))
                      }
                      placeholder="Optional supporting details."
                    />
                  </div>
                </div>
              </div>

              <div className="la-modal-actions">
                <button
                  type="button"
                  className="la-btn la-btn-secondary"
                  onClick={closeDraftForm}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="la-btn la-btn-primary"
                  disabled={saving}
                >
                  {saving ? (
                    <Loader2 size={16} className="spin" />
                  ) : (
                    <FilePenLine size={16} />
                  )}
                  {editingRecord ? 'Update Draft' : 'Save Draft'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {actionModal && actionRecord ? (
        <div className="la-modal-backdrop" role="presentation">
          <div
            className="la-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="loan-action-title"
          >
            <div className="la-modal-head">
              <div>
                <h2 id="loan-action-title">{actionTitle(actionModal)}</h2>
                <p>
                  {safeText(actionRecord.employee_name, 'Employee')} ·{' '}
                  {safeText(actionRecord.label, loanTypeLabel(actionRecord.type))}
                </p>
              </div>

              <button
                type="button"
                className="la-modal-close"
                onClick={closeAction}
                aria-label="Close"
                disabled={Boolean(actionLoading)}
              >
                ×
              </button>
            </div>

            <form onSubmit={executeAction}>
              <div className="la-modal-body">
                {actionModal === 'approve' ? (
                  <>
                    <div className="la-warning">
                      <AlertTriangle size={17} />
                      <span>
                        Interest is entered as an explicit amount. This page does not
                        calculate or assume an interest percentage.
                      </span>
                    </div>

                    <div className="la-form-grid">
                      <div className="la-field">
                        <label htmlFor="loan-approved-amount">
                          Approved amount *
                        </label>
                        <input
                          id="loan-approved-amount"
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={actionForm.approved_amount}
                          onChange={(event) =>
                            updateActionField(
                              'approved_amount',
                              event.target.value,
                            )
                          }
                          required
                        />
                      </div>

                      <div className="la-field">
                        <label htmlFor="loan-interest-amount">
                          Interest amount
                        </label>
                        <input
                          id="loan-interest-amount"
                          type="number"
                          min="0"
                          step="0.01"
                          value={actionForm.interest_amount}
                          onChange={(event) =>
                            updateActionField(
                              'interest_amount',
                              event.target.value,
                            )
                          }
                        />
                      </div>

                      <div className="la-field">
                        <label htmlFor="loan-emi-amount">Monthly EMI *</label>
                        <input
                          id="loan-emi-amount"
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={actionForm.emi_amount}
                          onChange={(event) =>
                            updateActionField('emi_amount', event.target.value)
                          }
                          required
                        />
                      </div>

                      <div className="la-field">
                        <label htmlFor="loan-recovery-start">
                          Recovery starts *
                        </label>
                        <input
                          id="loan-recovery-start"
                          type="month"
                          value={actionForm.recovery_start_period}
                          onChange={(event) =>
                            updateActionField(
                              'recovery_start_period',
                              event.target.value,
                            )
                          }
                          required
                        />
                      </div>

                      <div className="la-field">
                        <label htmlFor="loan-recovery-end">
                          Recovery ends (optional)
                        </label>
                        <input
                          id="loan-recovery-end"
                          type="month"
                          value={actionForm.recovery_end_period}
                          onChange={(event) =>
                            updateActionField(
                              'recovery_end_period',
                              event.target.value,
                            )
                          }
                        />
                      </div>

                      <div className="la-field">
                        <label htmlFor="loan-hold-periods">
                          Hold months (comma-separated)
                        </label>
                        <input
                          id="loan-hold-periods"
                          type="text"
                          value={actionForm.hold_periods}
                          onChange={(event) =>
                            updateActionField(
                              'hold_periods',
                              event.target.value,
                            )
                          }
                          placeholder="2026-09, 2026-12"
                        />
                      </div>
                    </div>
                  </>
                ) : null}

                {actionModal === 'recovery' ? (
                  <>
                    <div className="la-warning">
                      <AlertTriangle size={17} />
                      <span>
                        Revised terms apply only from the selected future payroll
                        period. Locked and disbursed payroll deductions remain
                        immutable.
                      </span>
                    </div>

                    <div className="la-form-grid">
                      <div className="la-field">
                        <label htmlFor="loan-revision-effective">
                          Effective from *
                        </label>
                        <input
                          id="loan-revision-effective"
                          type="month"
                          value={actionForm.effective_from_period}
                          onChange={(event) =>
                            updateActionField(
                              'effective_from_period',
                              event.target.value,
                            )
                          }
                          required
                        />
                      </div>

                      <div className="la-field">
                        <label htmlFor="loan-revised-emi">
                          Revised monthly EMI *
                        </label>
                        <input
                          id="loan-revised-emi"
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={actionForm.emi_amount}
                          onChange={(event) =>
                            updateActionField('emi_amount', event.target.value)
                          }
                          required
                        />
                      </div>

                      <div className="la-field">
                        <label htmlFor="loan-revised-end">
                          Recovery ends (optional)
                        </label>
                        <input
                          id="loan-revised-end"
                          type="month"
                          value={actionForm.recovery_end_period}
                          onChange={(event) =>
                            updateActionField(
                              'recovery_end_period',
                              event.target.value,
                            )
                          }
                        />
                      </div>

                      <div className="la-field">
                        <label htmlFor="loan-revised-holds">
                          Hold months (comma-separated)
                        </label>
                        <input
                          id="loan-revised-holds"
                          type="text"
                          value={actionForm.hold_periods}
                          onChange={(event) =>
                            updateActionField(
                              'hold_periods',
                              event.target.value,
                            )
                          }
                          placeholder="2026-09, 2026-12"
                        />
                      </div>
                    </div>
                  </>
                ) : null}

                {['approve', 'recovery'].includes(actionModal) ? (
                  <div className="la-installments">
                    <div className="la-installments-head">
                      <div>
                        <strong>Custom monthly installments</strong>
                        <div style={{ color: '#64748b', fontSize: 11, marginTop: 3 }}>
                          Optional month-specific deductions that override the normal EMI.
                        </div>
                      </div>
                      <button
                        type="button"
                        className="la-btn la-btn-secondary"
                        onClick={addInstallmentRow}
                      >
                        <Plus size={14} />
                        Add Month
                      </button>
                    </div>

                    {actionForm.custom_installments.length ? (
                      actionForm.custom_installments.map((row, index) => (
                        <div
                          className="la-installment-row"
                          key={`installment-${index}`}
                        >
                          <input
                            type="month"
                            aria-label="Installment month"
                            value={row.period_key}
                            onChange={(event) =>
                              updateInstallmentRow(
                                index,
                                'period_key',
                                event.target.value,
                              )
                            }
                          />
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            aria-label="Installment amount"
                            value={row.amount}
                            onChange={(event) =>
                              updateInstallmentRow(
                                index,
                                'amount',
                                event.target.value,
                              )
                            }
                            placeholder="Amount"
                          />
                          <select
                            aria-label="Installment status"
                            value={row.status}
                            onChange={(event) =>
                              updateInstallmentRow(
                                index,
                                'status',
                                event.target.value,
                              )
                            }
                          >
                            <option value="scheduled">Scheduled</option>
                            <option value="held">Held</option>
                            <option value="cancelled">Cancelled</option>
                          </select>
                          <input
                            type="text"
                            aria-label="Installment note"
                            value={row.note}
                            onChange={(event) =>
                              updateInstallmentRow(
                                index,
                                'note',
                                event.target.value,
                              )
                            }
                            placeholder="Optional note"
                          />
                          <button
                            type="button"
                            className="la-icon-btn"
                            onClick={() => removeInstallmentRow(index)}
                            aria-label="Remove installment"
                          >
                            ×
                          </button>
                        </div>
                      ))
                    ) : (
                      <div style={{ color: '#64748b', fontSize: 12 }}>
                        Normal EMI will apply every eligible payroll month.
                      </div>
                    )}
                  </div>
                ) : null}

                {actionModal === 'disburse' ? (
                  <div className="la-form-grid">
                    <div className="la-field">
                      <label htmlFor="loan-transfer-date">
                        Transfer date *
                      </label>
                      <input
                        id="loan-transfer-date"
                        type="date"
                        value={actionForm.transfer_date}
                        onChange={(event) =>
                          updateActionField(
                            'transfer_date',
                            event.target.value,
                          )
                        }
                        required
                      />
                    </div>

                    <div className="la-field">
                      <label htmlFor="loan-transfer-mode">
                        Transfer mode *
                      </label>
                      <select
                        id="loan-transfer-mode"
                        value={actionForm.transfer_mode}
                        onChange={(event) =>
                          updateActionField(
                            'transfer_mode',
                            event.target.value,
                          )
                        }
                        required
                      >
                        <option value="">Select mode</option>
                        <option value="NEFT">NEFT</option>
                        <option value="RTGS">RTGS</option>
                        <option value="IMPS">IMPS</option>
                        <option value="BANK_TRANSFER">Bank Transfer</option>
                        <option value="CHEQUE">Cheque</option>
                        <option value="CASH">Cash</option>
                      </select>
                    </div>

                    <div className="la-field">
                      <label htmlFor="loan-transaction-ref">
                        Transaction reference
                      </label>
                      <input
                        id="loan-transaction-ref"
                        type="text"
                        value={actionForm.transaction_reference}
                        onChange={(event) =>
                          updateActionField(
                            'transaction_reference',
                            event.target.value,
                          )
                        }
                        placeholder="UTR / transaction ID"
                      />
                    </div>

                    <div className="la-field">
                      <label htmlFor="loan-bank-ref">Bank reference</label>
                      <input
                        id="loan-bank-ref"
                        type="text"
                        value={actionForm.bank_reference}
                        onChange={(event) =>
                          updateActionField(
                            'bank_reference',
                            event.target.value,
                          )
                        }
                        placeholder="Optional bank batch reference"
                      />
                    </div>
                  </div>
                ) : null}

                {actionModal === 'reject' || actionModal === 'cancel' ? (
                  <div className="la-field">
                    <label htmlFor="loan-action-reason">
                      {actionModal === 'reject'
                        ? 'Rejection reason *'
                        : 'Cancellation reason *'}
                    </label>
                    <textarea
                      id="loan-action-reason"
                      value={actionForm.reason}
                      onChange={(event) =>
                        updateActionField('reason', event.target.value)
                      }
                      placeholder="Enter a clear reason."
                      required
                    />
                  </div>
                ) : null}

                {!['reject', 'cancel'].includes(actionModal) ? (
                  <div className="la-field">
                    <label htmlFor="loan-action-note">
                      Action note (optional)
                    </label>
                    <textarea
                      id="loan-action-note"
                      value={actionForm.note}
                      onChange={(event) =>
                        updateActionField('note', event.target.value)
                      }
                      placeholder="Add an internal workflow note."
                    />
                  </div>
                ) : null}
              </div>

              <div className="la-modal-actions">
                <button
                  type="button"
                  className="la-btn la-btn-secondary"
                  onClick={closeAction}
                  disabled={Boolean(actionLoading)}
                >
                  Go Back
                </button>

                <button
                  type="submit"
                  className={`la-btn ${
                    actionModal === 'reject' || actionModal === 'cancel'
                      ? 'la-btn-danger'
                      : actionModal === 'approve'
                        ? 'la-btn-success'
                        : 'la-btn-primary'
                  }`}
                  disabled={Boolean(actionLoading)}
                >
                  {actionLoading ? (
                    <Loader2 size={16} className="spin" />
                  ) : actionModal === 'approve' ? (
                    <CheckCircle2 size={16} />
                  ) : actionModal === 'reject' ? (
                    <XCircle size={16} />
                  ) : actionModal === 'disburse' ? (
                    <Landmark size={16} />
                  ) : actionModal === 'recovery' ? (
                    <SlidersHorizontal size={16} />
                  ) : (
                    <Ban size={16} />
                  )}
                  {actionTitle(actionModal)}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}