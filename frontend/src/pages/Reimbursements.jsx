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
  FileCheck2,
  FilePenLine,
  FileText,
  History,
  IndianRupee,
  Loader2,
  Paperclip,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  Send,
  UserRound,
  WalletCards,
  XCircle,
} from 'lucide-react';

import { api, getApiUrl, getToken } from '../api/client';
import { useCustomAlert } from '../components/CustomAlertProvider.jsx';

const DEFAULT_LIMIT = 500;
const RECEIPT_MAX_BYTES = 8 * 1024 * 1024;
const RECEIPT_ALLOWED_EXTENSIONS = new Set([
  'pdf',
  'jpg',
  'jpeg',
  'png',
  'webp',
]);
const RECEIPT_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp';

const REIMBURSEMENT_TYPES = [
  ['travel', 'Travel'],
  ['local_conveyance', 'Local Conveyance'],
  ['accommodation', 'Accommodation'],
  ['meals', 'Meals'],
  ['mobile_internet', 'Mobile & Internet'],
  ['medical', 'Medical'],
  ['office_supplies', 'Office Supplies'],
  ['training', 'Training'],
  ['relocation', 'Relocation'],
  ['fuel', 'Fuel'],
  ['client_entertainment', 'Client Entertainment'],
  ['other', 'Other'],
];

const FILTER_STATUSES = [
  ['', 'All statuses'],
  ['draft', 'Draft'],
  ['pending_hr_review', 'Pending HR Review'],
  ['pending_finance_approval', 'Pending Finance Approval'],
  ['approved', 'Approved'],
  ['scheduled', 'Scheduled'],
  ['paid', 'Paid'],
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

const HR_REVIEW_ROLES = new Set([
  'super_admin',
  'admin',
  'hr_admin',
  'hr_manager',
  'hr',
]);

const FINANCE_ACTION_ROLES = new Set([
  'super_admin',
  'admin',
  'finance',
  'accounts_finance',
]);

const CANCELLABLE_STATUSES = new Set([
  'draft',
  'pending_hr_review',
  'pending_finance_approval',
]);

const SCHEDULE_REVISABLE_STATUSES = new Set(['approved']);

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

  if (['approved', 'scheduled', 'paid'].includes(status)) {
    return 'success';
  }

  if (['pending_hr_review', 'pending_finance_approval'].includes(status)) {
    return 'info';
  }

  if (['rejected', 'cancelled'].includes(status)) {
    return 'danger';
  }

  return 'warning';
}

function recordId(record) {
  const value = record || {};
  return safeText(value._id || value.id, '');
}

function employeeId(employee) {
  const value = employee || {};
  return safeText(value._id || value.id || value.employee_id, '');
}

function employeeName(employee) {
  const value = employee || {};
  return safeText(
    value.employee_name ||
      value.name ||
      value.full_name ||
      value.display_name ||
      value.official_email,
    'Employee',
  );
}

function employeeCode(employee) {
  const value = employee || {};
  return safeText(
    value.employee_code ||
      value.emp_code ||
      value.employee_id ||
      value.code,
    '—',
  );
}

function fileExtension(filename) {
  const normalized = safeText(filename, '').toLowerCase();
  const dotIndex = normalized.lastIndexOf('.');
  return dotIndex >= 0 ? normalized.slice(dotIndex + 1) : '';
}

function formatFileSize(value) {
  const bytes = toNumber(value, 0);

  if (bytes <= 0) {
    return '';
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function responseErrorMessage(response, fallback) {
  try {
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const data = await response.json();
      return data.message || data.error?.message || data.error || fallback;
    }

    const text = await response.text();
    return text || fallback;
  } catch {
    return fallback;
  }
}

function sortEmployees(items = []) {
  return [...items].sort((left, right) =>
    employeeName(left).localeCompare(employeeName(right), 'en', {
      sensitivity: 'base',
    }),
  );
}

function reimbursementTypeLabel(value) {
  const normalized = normalizeKey(value);
  return (
    REIMBURSEMENT_TYPES.find(([key]) => key === normalized)?.[1] ||
    labelFromKey(value)
  );
}

function emptyItem() {
  return {
    type: 'travel',
    expense_date: '',
    description: '',
    amount: '',
    vendor: '',
    invoice_number: '',
    project_id: '',
    project_name: '',
    location: '',
    receipt_reference: '',
    receipt_filename: '',
    receipt_mime_type: '',
    receipt_size_bytes: 0,
    receipt_uploaded_at: '',
  };
}

function emptyDraft() {
  return {
    employee_id: '',
    type: 'travel',
    label: '',
    purpose: '',
    items: [emptyItem()],
  };
}

function emptyActionForm() {
  return {
    approved_amount: '',
    tax_treatment: 'non_taxable',
    payment_mode: 'payroll',
    payroll_period: '',
    note: '',
    reason: '',
    payment_date: '',
    payment_reference: '',
    manual_payment_mode: 'bank_transfer',
  };
}

function itemAmountTotal(items = []) {
  return items.reduce((total, item) => total + toNumber(item.amount, 0), 0);
}

function workflowHistory(record) {
  const history = record?.workflow_history;
  return Array.isArray(history) ? [...history].reverse() : [];
}

function actionTitle(action) {
  const titles = {
    hr_review: 'Complete HR Review',
    approve: 'Approve Reimbursement',
    reject: 'Reject Reimbursement',
    cancel: 'Cancel Reimbursement',
    schedule: 'Revise Payment Schedule',
    manual_payment: 'Record Manual Payment',
  };

  return titles[action] || 'Reimbursement Action';
}

export default function Reimbursements({ user = {} }) {
  const alerts = useCustomAlert();
  const superAdmin = isSuperAdmin(user);
  const canManage = hasAnyRole(user, MANAGEMENT_ROLES);
  const canHrReview = hasAnyRole(user, HR_REVIEW_ROLES);
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
  const [periodFilter, setPeriodFilter] = useState('');
  const [search, setSearch] = useState('');

  const [loading, setLoading] = useState(false);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [uploadingReceiptIndex, setUploadingReceiptIndex] = useState(-1);

  const [showDraftForm, setShowDraftForm] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null);
  const [draft, setDraft] = useState(emptyDraft());

  const [actionModal, setActionModal] = useState('');
  const [actionRecord, setActionRecord] = useState(null);
  const [actionForm, setActionForm] = useState(emptyActionForm());

  const [showWorkflow, setShowWorkflow] = useState(true);
  const [showItems, setShowItems] = useState(true);

  const filteredItems = useMemo(() => {
    const term = normalizeKey(search);

    if (!term) {
      return items;
    }

    return items.filter((item) => {
      const itemText = (item.items || [])
        .map((row) => `${row.description} ${row.vendor} ${row.invoice_number}`)
        .join(' ');

      const haystack = [
        item.employee_name,
        item.employee_code,
        item.label,
        item.type,
        item.status,
        item.purpose,
        item.tax_treatment,
        item.payment_mode,
        item.payroll_period,
        itemText,
      ]
        .map(normalizeKey)
        .join(' ');

      return haystack.includes(term);
    });
  }, [items, search]);

  const metrics = useMemo(() => {
    const pendingHr = items.filter(
      (item) => normalizeKey(item.status) === 'pending_hr_review',
    ).length;
    const pendingFinance = items.filter(
      (item) => normalizeKey(item.status) === 'pending_finance_approval',
    ).length;
    const approved = items.reduce(
      (total, item) => total + toNumber(item.approved_amount, 0),
      0,
    );
    const paid = items
      .filter((item) => normalizeKey(item.status) === 'paid')
      .reduce(
        (total, item) =>
          total + toNumber(item.paid_amount || item.approved_amount, 0),
        0,
      );

    return {
      total: items.length,
      pendingHr,
      pendingFinance,
      approved,
      paid,
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
        'Enter the company tenant ID before loading or changing reimbursement records.',
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
        `/payroll/reimbursements${buildQuery({
          ...tenantParams(),
          status: statusFilter,
          type: typeFilter,
          employee_id: canManage ? employeeFilter : '',
          payroll_period: periodFilter,
          limit: DEFAULT_LIMIT,
        })}`,
      );
      const rows = Array.isArray(data.items) ? data.items : [];

      setItems(rows);

      const desiredId = preferredId || recordId(selectedRecord);

      if (desiredId) {
        const updatedSelection = rows.find(
          (row) => recordId(row) === desiredId,
        );

        setSelectedRecord(updatedSelection || null);
      }

      return rows;
    } catch (error) {
      setItems([]);
      setSelectedRecord(null);

      if (!silent) {
        alerts.error(
          error.message || 'Unable to load reimbursements.',
          'Reimbursement Load Failed',
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
        `/payroll/reimbursements/${encodeURIComponent(id)}${buildQuery(
          tenantParams(),
        )}`,
      );
      const record = data.reimbursement || null;

      setSelectedRecord(record);
      return record;
    } catch (error) {
      if (!silent) {
        alerts.error(
          error.message || 'Unable to load reimbursement details.',
          'Reimbursement Detail Failed',
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
  }, [statusFilter, typeFilter, employeeFilter, periodFilter]);

  function openCreate() {
    if (!assertTenant()) {
      return;
    }

    setEditingRecord(null);
    setDraft(emptyDraft());
    setShowDraftForm(true);
  }

  function normalizeRecordItems(record = {}) {
    return (record.items || []).map((item) => {
      const firstReceipt = (item.receipts || [])[0] || {};

      return {
        type: normalizeKey(item.type || item.category) || 'other',
        expense_date: safeText(item.expense_date, ''),
        description: safeText(item.description, ''),
        amount: safeText(item.amount, ''),
        vendor: safeText(item.vendor, ''),
        invoice_number: safeText(item.invoice_number, ''),
        project_id: safeText(item.project_id, ''),
        project_name: safeText(item.project_name, ''),
        location: safeText(item.location, ''),
        receipt_reference: safeText(firstReceipt.reference, ''),
        receipt_filename: safeText(firstReceipt.filename, ''),
        receipt_mime_type: safeText(firstReceipt.mime_type, ''),
        receipt_size_bytes: toNumber(firstReceipt.size_bytes, 0),
        receipt_uploaded_at: safeText(firstReceipt.uploaded_at, ''),
      };
    });
  }

  function openEdit(record) {
    setEditingRecord(record);
    setDraft({
      employee_id: safeText(record.employee_id, ''),
      type: normalizeKey(record.type || record.claim_type) || 'other',
      label: safeText(record.label, ''),
      purpose: safeText(record.purpose, ''),
      items: normalizeRecordItems(record).length
        ? normalizeRecordItems(record)
        : [emptyItem()],
    });
    setShowDraftForm(true);
  }

  function resetDraftForm() {
    setShowDraftForm(false);
    setEditingRecord(null);
    setDraft(emptyDraft());
  }

  function closeDraftForm() {
    if (saving || uploadingReceiptIndex >= 0) {
      return;
    }

    resetDraftForm();
  }

  function updateDraftField(field, value) {
    setDraft((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function addExpenseItem() {
    setDraft((current) => ({
      ...current,
      items: [...current.items, emptyItem()],
    }));
  }

  function updateExpenseItem(index, field, value) {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              [field]: value,
            }
          : item,
      ),
    }));
  }

  function removeExpenseItem(index) {
    setDraft((current) => ({
      ...current,
      items:
        current.items.length === 1
          ? current.items
          : current.items.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  function updateExpenseItemFields(index, values) {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              ...values,
            }
          : item,
      ),
    }));
  }

  function removeReceipt(index) {
    updateExpenseItemFields(index, {
      receipt_reference: '',
      receipt_filename: '',
      receipt_mime_type: '',
      receipt_size_bytes: 0,
      receipt_uploaded_at: '',
    });
  }

  async function uploadReceipt(index, file) {
    if (!file || !assertTenant()) {
      return;
    }

    const extension = fileExtension(file.name);

    if (!RECEIPT_ALLOWED_EXTENSIONS.has(extension)) {
      alerts.warning(
        'Select a PDF, JPG, JPEG, PNG or WEBP receipt.',
        'Unsupported Receipt Type',
      );
      return;
    }

    if (file.size <= 0) {
      alerts.warning('The selected receipt is empty.', 'Empty Receipt');
      return;
    }

    if (file.size > RECEIPT_MAX_BYTES) {
      alerts.warning(
        'Receipt files must be 8 MB or smaller.',
        'Receipt Too Large',
      );
      return;
    }

    try {
      setUploadingReceiptIndex(index);

      const formData = new FormData();
      formData.append('file', file, file.name);

      Object.entries(tenantParams()).forEach(([key, value]) => {
        formData.append(key, String(value));
      });

      const token = getToken();
      const response = await fetch(
        getApiUrl('/payroll/reimbursements/receipts/upload'),
        {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: formData,
        },
      );

      if (!response.ok) {
        throw new Error(
          await responseErrorMessage(
            response,
            'Unable to upload the reimbursement receipt.',
          ),
        );
      }

      const data = await response.json();
      const receipt = data.receipt || data.data?.receipt || null;

      if (!receipt?.reference) {
        throw new Error('The server did not return a receipt reference.');
      }

      updateExpenseItemFields(index, {
        receipt_reference: safeText(receipt.reference, ''),
        receipt_filename: safeText(receipt.filename, file.name),
        receipt_mime_type: safeText(receipt.mime_type, file.type),
        receipt_size_bytes: toNumber(receipt.size_bytes, file.size),
        receipt_uploaded_at: safeText(receipt.uploaded_at, ''),
      });

      alerts.success(
        `${safeText(receipt.filename, file.name)} uploaded successfully.`,
        'Receipt Uploaded',
      );
    } catch (error) {
      alerts.error(
        error.message || 'Unable to upload the reimbursement receipt.',
        'Receipt Upload Failed',
      );
    } finally {
      setUploadingReceiptIndex(-1);
    }
  }

  function validateDraft() {
    if (canManage && !draft.employee_id) {
      return 'Select an employee.';
    }

    if (!draft.type) {
      return 'Select a reimbursement type.';
    }

    if (!draft.purpose.trim()) {
      return 'Enter the purpose of the reimbursement.';
    }

    if (!draft.items.length) {
      return 'Add at least one reimbursement item.';
    }

    for (let index = 0; index < draft.items.length; index += 1) {
      const item = draft.items[index];

      if (!item.expense_date) {
        return `Select the expense date for item ${index + 1}.`;
      }

      if (!item.description.trim()) {
        return `Enter the description for item ${index + 1}.`;
      }

      if (toNumber(item.amount, 0) <= 0) {
        return `Amount for item ${index + 1} must be greater than zero.`;
      }
    }

    return '';
  }

  function payloadItems() {
    return draft.items.map((item) => ({
      type: item.type,
      expense_date: item.expense_date,
      description: item.description.trim(),
      amount: toNumber(item.amount, 0),
      vendor: item.vendor.trim(),
      invoice_number: item.invoice_number.trim(),
      project_id: item.project_id.trim(),
      project_name: item.project_name.trim(),
      location: item.location.trim(),
      receipts: item.receipt_reference.trim()
        ? [
            {
              reference: item.receipt_reference.trim(),
              filename: item.receipt_filename.trim(),
              mime_type: item.receipt_mime_type.trim(),
              size_bytes: toNumber(item.receipt_size_bytes, 0),
              uploaded_at: item.receipt_uploaded_at || undefined,
            },
          ]
        : [],
    }));
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
    const normalizedItems = payloadItems();

    try {
      setSaving(true);

      const payload = {
        ...tenantParams(),
        type: draft.type,
        label: draft.label.trim(),
        purpose: draft.purpose.trim(),
        claimed_amount: itemAmountTotal(normalizedItems),
        items: normalizedItems,
        ...(canManage && draft.employee_id
          ? { employee_id: draft.employee_id }
          : {}),
      };

      const data = await api(
        editingId
          ? `/payroll/reimbursements/${encodeURIComponent(editingId)}`
          : '/payroll/reimbursements',
        {
          method: editingId ? 'PATCH' : 'POST',
          body: JSON.stringify(payload),
        },
      );

      const saved = data.reimbursement || data.record || data.item || null;
      const savedId = recordId(saved) || editingId;

      alerts.success(
        data.message ||
          (editingId
            ? 'Reimbursement draft updated successfully.'
            : 'Reimbursement draft created successfully.'),
        editingId ? 'Draft Updated' : 'Draft Created',
      );

      resetDraftForm();
      await refreshAll({
        silent: true,
        preferredId: savedId,
      });

      if (savedId) {
        await loadDetail(savedId, { silent: true });
      }
    } catch (error) {
      alerts.error(
        error.message || 'Unable to save the reimbursement draft.',
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

    const claimItems = Array.isArray(record?.items) ? record.items : [];
    const missingReceiptIndex = claimItems.findIndex(
      (item) => !Array.isArray(item?.receipts) || item.receipts.length === 0,
    );

    if (missingReceiptIndex >= 0) {
      alerts.warning(
        `Attach a receipt to reimbursement item ${missingReceiptIndex + 1} before submitting.`,
        'Receipt Required',
      );
      openEdit(record);
      return;
    }

    const confirmed = await alerts.confirm(
      'Submit this reimbursement for HR review? Ensure every item contains the required receipt reference before continuing.',
      'Submit Reimbursement',
      {
        confirmText: 'Submit for HR Review',
        cancelText: 'Keep Draft',
      },
    );

    if (!confirmed) {
      return;
    }

    try {
      setActionLoading(`submit-${id}`);

      const data = await api(
        `/payroll/reimbursements/${encodeURIComponent(id)}/submit`,
        {
          method: 'POST',
          body: JSON.stringify({
            ...tenantParams(),
            note: 'Submitted for HR review.',
          }),
        },
      );

      alerts.success(
        data.message || 'Reimbursement submitted successfully.',
        'Reimbursement Submitted',
      );
      await refreshAll({
        silent: true,
        preferredId: id,
      });
      await loadDetail(id, { silent: true });
    } catch (error) {
      alerts.error(
        error.message || 'Unable to submit the reimbursement.',
        'Submission Failed',
      );
    } finally {
      setActionLoading('');
    }
  }

  function openAction(action, record) {
    setActionRecord(record);
    setActionForm({
      ...emptyActionForm(),
      approved_amount: safeText(
        record.approved_amount || record.claimed_amount,
        '',
      ),
      tax_treatment: normalizeKey(record.tax_treatment) || 'non_taxable',
      payment_mode: normalizeKey(record.payment_mode) || 'payroll',
      payroll_period: safeText(record.payroll_period, ''),
    });
    setActionModal(action);
  }

  function resetAction() {
    setActionModal('');
    setActionRecord(null);
    setActionForm(emptyActionForm());
  }

  function closeAction() {
    if (actionLoading) {
      return;
    }

    resetAction();
  }

  function updateActionField(field, value) {
    setActionForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function validateAction() {
    if (actionModal === 'approve') {
      const claimedAmount = toNumber(actionRecord?.claimed_amount, 0);
      const approvedAmount = toNumber(actionForm.approved_amount, 0);

      if (approvedAmount <= 0) {
        return 'Approved amount must be greater than zero.';
      }

      if (approvedAmount > claimedAmount) {
        return 'Approved amount cannot exceed the claimed amount.';
      }

      if (!['taxable', 'non_taxable'].includes(actionForm.tax_treatment)) {
        return 'Select the tax treatment.';
      }

      if (!['payroll', 'manual'].includes(actionForm.payment_mode)) {
        return 'Select the payment mode.';
      }

      if (
        actionForm.payment_mode === 'payroll' &&
        !actionForm.payroll_period
      ) {
        return 'Select the payroll month.';
      }
    }

    if (actionModal === 'schedule') {
      if (!['payroll', 'manual'].includes(actionForm.payment_mode)) {
        return 'Select the payment mode.';
      }

      if (
        actionForm.payment_mode === 'payroll' &&
        !actionForm.payroll_period
      ) {
        return 'Select the payroll month.';
      }
    }

    if (['reject', 'cancel'].includes(actionModal)) {
      if (!actionForm.reason.trim()) {
        return actionModal === 'reject'
          ? 'Enter a rejection reason.'
          : 'Enter a cancellation reason.';
      }
    }

    if (actionModal === 'manual_payment') {
      if (!actionForm.payment_date) {
        return 'Enter the payment date.';
      }

      if (!actionForm.payment_reference.trim()) {
        return 'Enter the payment reference.';
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
      actionTitle(actionModal),
      {
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

    if (actionModal === 'hr_review') {
      endpoint = 'hr-review';
      payload = {
        ...payload,
        note: actionForm.note.trim(),
      };
    } else if (actionModal === 'approve') {
      endpoint = 'approve';
      payload = {
        ...payload,
        approved_amount: toNumber(actionForm.approved_amount, 0),
        tax_treatment: actionForm.tax_treatment,
        payment_mode: actionForm.payment_mode,
        payroll_period:
          actionForm.payment_mode === 'payroll'
            ? actionForm.payroll_period
            : '',
        note: actionForm.note.trim(),
      };
    } else if (actionModal === 'reject') {
      endpoint = 'reject';
      payload = {
        ...payload,
        reason: actionForm.reason.trim(),
      };
    } else if (actionModal === 'cancel') {
      endpoint = 'cancel';
      payload = {
        ...payload,
        reason: actionForm.reason.trim(),
      };
    } else if (actionModal === 'schedule') {
      endpoint = 'payment-schedule';
      payload = {
        ...payload,
        payment_mode: actionForm.payment_mode,
        payroll_period:
          actionForm.payment_mode === 'payroll'
            ? actionForm.payroll_period
            : '',
        note: actionForm.note.trim(),
      };
    } else if (actionModal === 'manual_payment') {
      endpoint = 'manual-payment';
      payload = {
        ...payload,
        payment_date: actionForm.payment_date,
        payment_reference: actionForm.payment_reference.trim(),
        payment_mode: actionForm.manual_payment_mode,
        note: actionForm.note.trim(),
      };
    }

    try {
      setActionLoading(`${actionModal}-${id}`);

      const data = await api(
        `/payroll/reimbursements/${encodeURIComponent(id)}/${endpoint}`,
        {
          method: 'POST',
          body: JSON.stringify(payload),
        },
      );

      alerts.success(
        data.message || 'Reimbursement updated successfully.',
        'Action Completed',
      );
      resetAction();
      await refreshAll({
        silent: true,
        preferredId: id,
      });
      await loadDetail(id, { silent: true });
    } catch (error) {
      alerts.error(
        error.message || 'Unable to complete the reimbursement action.',
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
      <div className={`reim-action-buttons ${compact ? 'is-compact' : ''}`}>
        {status === 'draft' ? (
          <>
            <button
              type="button"
              className="reim-btn reim-btn-secondary"
              onClick={(event) => {
                event.stopPropagation();
                openEdit(record);
              }}
              disabled={busy}
            >
              <FilePenLine size={15} />
              Edit
            </button>

            <button
              type="button"
              className="reim-btn reim-btn-primary"
              onClick={(event) => {
                event.stopPropagation();
                submitRecord(record);
              }}
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

        {status === 'pending_hr_review' && canHrReview ? (
          <>
            <button
              type="button"
              className="reim-btn reim-btn-success"
              onClick={(event) => {
                event.stopPropagation();
                openAction('hr_review', record);
              }}
              disabled={busy}
            >
              <FileCheck2 size={15} />
              HR Review
            </button>

            <button
              type="button"
              className="reim-btn reim-btn-danger"
              onClick={(event) => {
                event.stopPropagation();
                openAction('reject', record);
              }}
              disabled={busy}
            >
              <XCircle size={15} />
              Reject
            </button>
          </>
        ) : null}

        {status === 'pending_finance_approval' && canFinanceAct ? (
          <>
            <button
              type="button"
              className="reim-btn reim-btn-success"
              onClick={(event) => {
                event.stopPropagation();
                openAction('approve', record);
              }}
              disabled={busy}
            >
              <CheckCircle2 size={15} />
              Approve
            </button>

            <button
              type="button"
              className="reim-btn reim-btn-danger"
              onClick={(event) => {
                event.stopPropagation();
                openAction('reject', record);
              }}
              disabled={busy}
            >
              <XCircle size={15} />
              Reject
            </button>
          </>
        ) : null}

        {status === 'approved' && canFinanceAct ? (
          <>
            {SCHEDULE_REVISABLE_STATUSES.has(status) ? (
              <button
                type="button"
                className="reim-btn reim-btn-secondary"
                onClick={(event) => {
                  event.stopPropagation();
                  openAction('schedule', record);
                }}
                disabled={busy}
              >
                <CalendarDays size={15} />
                Schedule
              </button>
            ) : null}

            {normalizeKey(record.payment_mode) === 'manual' ? (
              <button
                type="button"
                className="reim-btn reim-btn-primary"
                onClick={(event) => {
                  event.stopPropagation();
                  openAction('manual_payment', record);
                }}
                disabled={busy}
              >
                <Banknote size={15} />
                Mark Paid
              </button>
            ) : null}
          </>
        ) : null}

        {CANCELLABLE_STATUSES.has(status) ? (
          <button
            type="button"
            className="reim-btn reim-btn-ghost-danger"
            onClick={(event) => {
              event.stopPropagation();
              openAction('cancel', record);
            }}
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
    <div className="reimbursements-page">
      <style>{`
        .reimbursements-page {
          display: grid;
          gap: 18px;
          min-width: 0;
          color: var(--text, #172033);
        }

        .reimbursements-page * {
          box-sizing: border-box;
        }

        .reim-panel {
          min-width: 0;
          padding: 20px;
          border: 1px solid var(--border, #dfe5ee);
          border-radius: 18px;
          background: var(--card, #ffffff);
          box-shadow: 0 12px 32px rgba(15, 23, 42, 0.06);
        }

        .reim-hero {
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

        .reim-hero::after {
          position: absolute;
          right: -40px;
          bottom: -65px;
          width: 190px;
          height: 190px;
          border-radius: 50%;
          background: rgba(67, 97, 238, 0.07);
          content: '';
        }

        .reim-hero-content,
        .reim-hero-actions {
          position: relative;
          z-index: 1;
        }

        .reim-kicker {
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

        .reim-hero h1 {
          margin: 0 0 8px;
          font-size: clamp(25px, 3vw, 36px);
          line-height: 1.1;
        }

        .reim-hero p {
          max-width: 790px;
          margin: 0;
          color: var(--muted, #64748b);
          line-height: 1.65;
        }

        .reim-hero-actions {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 10px;
        }

        .reim-btn {
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

        .reim-btn:hover:not(:disabled) {
          transform: translateY(-1px);
        }

        .reim-btn:disabled {
          cursor: not-allowed;
          opacity: 0.55;
        }

        .reim-btn-primary {
          color: #fff;
          background: #4056d6;
          border-color: #4056d6;
        }

        .reim-btn-success {
          color: #fff;
          background: #07875f;
          border-color: #07875f;
        }

        .reim-btn-danger {
          color: #fff;
          background: #c9364b;
          border-color: #c9364b;
        }

        .reim-btn-secondary {
          color: #27324a;
          background: #fff;
          border-color: var(--border, #dfe5ee);
        }

        .reim-btn-ghost-danger {
          color: #b4233a;
          background: rgba(201, 54, 75, 0.06);
          border-color: rgba(201, 54, 75, 0.18);
        }

        .reim-metrics {
          display: grid;
          grid-template-columns: repeat(5, minmax(150px, 1fr));
          gap: 13px;
        }

        .reim-metric {
          min-width: 0;
          padding: 17px;
          border: 1px solid var(--border, #dfe5ee);
          border-radius: 16px;
          background: var(--card, #fff);
        }

        .reim-metric-head {
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

        .reim-metric strong {
          display: block;
          overflow: hidden;
          font-size: clamp(22px, 2.5vw, 30px);
          line-height: 1.15;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .reim-toolbar {
          display: grid;
          grid-template-columns: minmax(220px, 1.4fr) repeat(4, minmax(150px, 0.7fr));
          gap: 12px;
          align-items: end;
        }

        .reim-field {
          display: grid;
          gap: 7px;
          min-width: 0;
        }

        .reim-field label {
          color: #465269;
          font-size: 12px;
          font-weight: 850;
        }

        .reim-field input,
        .reim-field select,
        .reim-field textarea {
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

        .reim-field textarea {
          min-height: 92px;
          resize: vertical;
          line-height: 1.5;
        }

        .reim-field input:focus,
        .reim-field select:focus,
        .reim-field textarea:focus {
          border-color: #566be0;
          box-shadow: 0 0 0 3px rgba(64, 86, 214, 0.11);
        }

        .reim-receipt-box {
          display: grid;
          gap: 10px;
          padding: 13px;
          border: 1px dashed #b9c6da;
          border-radius: 13px;
          background: #f8faff;
        }

        .reim-receipt-box.is-attached {
          border-style: solid;
          border-color: #a8dfcb;
          background: #f1fbf7;
        }

        .reim-receipt-summary {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }

        .reim-receipt-summary svg {
          flex: 0 0 auto;
          color: #4056d6;
        }

        .reim-receipt-summary div {
          min-width: 0;
        }

        .reim-receipt-summary strong,
        .reim-receipt-summary small {
          display: block;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .reim-receipt-summary small {
          margin-top: 3px;
          color: #64748b;
          font-size: 11px;
        }

        .reim-receipt-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .reim-file-input {
          position: absolute;
          width: 1px !important;
          height: 1px !important;
          min-height: 0 !important;
          padding: 0 !important;
          overflow: hidden;
          clip: rect(0 0 0 0);
          white-space: nowrap;
          border: 0 !important;
        }

        .reim-file-label {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          min-height: 38px;
          padding: 8px 12px;
          border: 1px solid #cbd5e1;
          border-radius: 10px;
          background: #fff;
          color: #334155;
          font-size: 12px;
          font-weight: 850;
          cursor: pointer;
        }

        .reim-file-label.is-disabled {
          cursor: wait;
          opacity: 0.65;
        }

        .reim-search-wrap {
          position: relative;
        }

        .reim-search-wrap svg {
          position: absolute;
          top: 50%;
          left: 12px;
          color: #8a96aa;
          transform: translateY(-50%);
          pointer-events: none;
        }

        .reim-search-wrap input {
          padding-left: 38px;
        }

        .reim-main-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.3fr) minmax(340px, 0.7fr);
          gap: 18px;
          align-items: start;
        }

        .reim-section-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          margin-bottom: 16px;
        }

        .reim-section-head h2,
        .reim-section-head h3 {
          margin: 0 0 5px;
          font-size: 19px;
        }

        .reim-section-head p {
          margin: 0;
          color: var(--muted, #64748b);
          font-size: 13px;
          line-height: 1.5;
        }

        .reim-record-list {
          display: grid;
          gap: 11px;
        }

        .reim-record {
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

        .reim-record:hover {
          border-color: rgba(64, 86, 214, 0.45);
          box-shadow: 0 10px 26px rgba(35, 48, 80, 0.08);
          transform: translateY(-1px);
        }

        .reim-record.is-selected {
          border-color: #4056d6;
          box-shadow: 0 0 0 3px rgba(64, 86, 214, 0.1);
        }

        .reim-record-title {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
          margin-bottom: 7px;
        }

        .reim-record-title strong {
          min-width: 0;
          font-size: 15px;
        }

        .reim-record-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 7px 14px;
          color: var(--muted, #64748b);
          font-size: 12px;
        }

        .reim-record-meta span {
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }

        .reim-record-amount {
          text-align: right;
        }

        .reim-record-amount strong {
          display: block;
          margin-bottom: 5px;
          font-size: 17px;
        }

        .reim-record-amount small {
          color: var(--muted, #64748b);
          font-weight: 700;
        }

        .reim-status {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 5px 9px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 900;
          white-space: nowrap;
        }

        .reim-status-success {
          color: #047857;
          background: rgba(5, 150, 105, 0.1);
        }

        .reim-status-info {
          color: #1d4ed8;
          background: rgba(37, 99, 235, 0.1);
        }

        .reim-status-danger {
          color: #b4233a;
          background: rgba(201, 54, 75, 0.1);
        }

        .reim-status-warning {
          color: #9a5b00;
          background: rgba(245, 158, 11, 0.13);
        }

        .reim-empty {
          display: grid;
          place-items: center;
          min-height: 220px;
          padding: 30px;
          border: 1px dashed var(--border, #d7dee9);
          border-radius: 15px;
          color: var(--muted, #64748b);
          text-align: center;
        }

        .reim-empty svg {
          margin-bottom: 10px;
          opacity: 0.6;
        }

        .reim-detail {
          position: sticky;
          top: 18px;
          min-width: 0;
        }

        .reim-detail-identity {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          padding-bottom: 15px;
          border-bottom: 1px solid var(--border, #e3e7ef);
        }

        .reim-detail-identity h2 {
          margin: 0 0 5px;
          font-size: 20px;
        }

        .reim-detail-identity p {
          margin: 0;
          color: var(--muted, #64748b);
          font-size: 13px;
        }

        .reim-detail-stats {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin: 15px 0;
        }

        .reim-detail-stat {
          min-width: 0;
          padding: 12px;
          border-radius: 12px;
          background: rgba(148, 163, 184, 0.09);
        }

        .reim-detail-stat span {
          display: block;
          margin-bottom: 4px;
          color: var(--muted, #64748b);
          font-size: 11px;
          font-weight: 850;
          text-transform: uppercase;
        }

        .reim-detail-stat strong {
          display: block;
          overflow: hidden;
          font-size: 15px;
          text-overflow: ellipsis;
        }

        .reim-note {
          padding: 12px 13px;
          border-left: 3px solid #6072dd;
          border-radius: 8px;
          background: rgba(64, 86, 214, 0.06);
          color: #3d4961;
          font-size: 13px;
          line-height: 1.55;
        }

        .reim-warning {
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

        .reim-action-buttons {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 15px;
        }

        .reim-action-buttons.is-compact {
          justify-content: flex-end;
          margin-top: 10px;
        }

        .reim-action-buttons.is-compact .reim-btn {
          min-height: 34px;
          padding: 7px 10px;
          font-size: 12px;
        }

        .reim-accordion {
          margin-top: 14px;
          border: 1px solid var(--border, #dfe5ee);
          border-radius: 13px;
          overflow: hidden;
        }

        .reim-accordion-button {
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

        .reim-item-list,
        .reim-timeline {
          display: grid;
          gap: 0;
          max-height: 340px;
          overflow: auto;
          padding: 4px 14px 12px;
        }

        .reim-item-card,
        .reim-timeline-item {
          position: relative;
          padding: 11px 0;
          border-bottom: 1px solid rgba(226, 232, 240, 0.9);
        }

        .reim-item-card:last-child,
        .reim-timeline-item:last-child {
          border-bottom: 0;
        }

        .reim-item-card strong,
        .reim-timeline-item strong {
          display: block;
          margin-bottom: 3px;
          font-size: 12px;
        }

        .reim-item-card p,
        .reim-item-card small,
        .reim-timeline-item p,
        .reim-timeline-item small {
          display: block;
          margin: 0;
          color: var(--muted, #64748b);
          font-size: 11px;
          line-height: 1.45;
        }

        .reim-modal-backdrop {
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

        .reim-modal {
          width: min(820px, 100%);
          max-height: calc(100vh - 44px);
          overflow: auto;
          border: 1px solid rgba(255, 255, 255, 0.35);
          border-radius: 20px;
          background: #fff;
          box-shadow: 0 30px 90px rgba(15, 23, 42, 0.3);
        }

        .reim-modal-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          padding: 20px 22px 14px;
          border-bottom: 1px solid #e4e8ef;
        }

        .reim-modal-head h2 {
          margin: 0 0 4px;
          font-size: 21px;
        }

        .reim-modal-head p {
          margin: 0;
          color: #64748b;
          font-size: 13px;
        }

        .reim-modal-close {
          width: 38px;
          height: 38px;
          border: 1px solid #dfe5ee;
          border-radius: 10px;
          background: #fff;
          color: #334155;
          cursor: pointer;
        }

        .reim-modal-body {
          display: grid;
          gap: 15px;
          padding: 20px 22px;
        }

        .reim-form-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 13px;
        }

        .reim-field-full {
          grid-column: 1 / -1;
        }

        .reim-modal-actions {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 10px;
          padding: 14px 22px 20px;
          border-top: 1px solid #e4e8ef;
        }

        .reim-expense-items {
          display: grid;
          gap: 12px;
        }

        .reim-expense-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .reim-expense-card {
          display: grid;
          gap: 12px;
          padding: 14px;
          border: 1px solid #e1e6ef;
          border-radius: 14px;
          background: #fafbfe;
        }

        .reim-expense-card-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .reim-expense-card-head strong {
          font-size: 13px;
        }

        .reim-icon-btn {
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

        .reim-total {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 13px 14px;
          border-radius: 12px;
          background: rgba(64, 86, 214, 0.07);
        }

        .reim-total span {
          color: #536078;
          font-size: 13px;
          font-weight: 800;
        }

        .reim-total strong {
          font-size: 18px;
        }

        .spin {
          animation: reim-spin 0.9s linear infinite;
        }

        @keyframes reim-spin {
          to {
            transform: rotate(360deg);
          }
        }

        @media (max-width: 1200px) {
          .reim-metrics {
            grid-template-columns: repeat(3, minmax(150px, 1fr));
          }

          .reim-toolbar {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .reim-main-grid {
            grid-template-columns: 1fr;
          }

          .reim-detail {
            position: static;
          }
        }

        @media (max-width: 760px) {
          .reim-hero {
            flex-direction: column;
            padding: 20px;
          }

          .reim-hero-actions {
            width: 100%;
            justify-content: stretch;
          }

          .reim-hero-actions .reim-btn {
            flex: 1;
          }

          .reim-metrics,
          .reim-toolbar,
          .reim-form-grid {
            grid-template-columns: 1fr;
          }

          .reim-record {
            grid-template-columns: 1fr;
          }

          .reim-record-amount {
            text-align: left;
          }

          .reim-action-buttons.is-compact {
            justify-content: flex-start;
          }

          .reim-modal-backdrop {
            align-items: end;
            padding: 0;
          }

          .reim-modal {
            max-height: 94vh;
            border-radius: 20px 20px 0 0;
          }

          .reim-modal-head,
          .reim-modal-body,
          .reim-modal-actions {
            padding-left: 16px;
            padding-right: 16px;
          }
        }
      `}</style>

      <header className="reim-hero">
        <div className="reim-hero-content">
          <span className="reim-kicker">
            <ReceiptText size={15} />
            Employee Claims
          </span>
          <h1>Reimbursements</h1>
          <p>
            Manage itemized employee claims, receipts, HR review, Finance
            approval, taxable or non-taxable treatment, payroll scheduling and
            manual payment completion.
          </p>
        </div>

        <div className="reim-hero-actions">
          <button
            type="button"
            className="reim-btn reim-btn-secondary"
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
            className="reim-btn reim-btn-primary"
            onClick={openCreate}
          >
            <Plus size={17} />
            New Claim
          </button>
        </div>
      </header>

      <section className="reim-metrics">
        <article className="reim-metric">
          <div className="reim-metric-head">
            <span>Total claims</span>
            <ReceiptText size={17} />
          </div>
          <strong>{metrics.total}</strong>
        </article>

        <article className="reim-metric">
          <div className="reim-metric-head">
            <span>Pending HR</span>
            <Clock3 size={17} />
          </div>
          <strong>{metrics.pendingHr}</strong>
        </article>

        <article className="reim-metric">
          <div className="reim-metric-head">
            <span>Pending Finance</span>
            <FileCheck2 size={17} />
          </div>
          <strong>{metrics.pendingFinance}</strong>
        </article>

        <article className="reim-metric">
          <div className="reim-metric-head">
            <span>Approved value</span>
            <CircleDollarSign size={17} />
          </div>
          <strong>{formatCurrency(metrics.approved)}</strong>
        </article>

        <article className="reim-metric">
          <div className="reim-metric-head">
            <span>Paid value</span>
            <CheckCircle2 size={17} />
          </div>
          <strong>{formatCurrency(metrics.paid)}</strong>
        </article>
      </section>

      <section className="reim-panel">
        <div className="reim-toolbar">
          <div className="reim-field">
            <label htmlFor="reimbursement-search">Search claims</label>
            <div className="reim-search-wrap">
              <Search size={16} />
              <input
                id="reimbursement-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Employee, type, purpose, status or invoice"
              />
            </div>
          </div>

          <div className="reim-field">
            <label htmlFor="reimbursement-status-filter">Status</label>
            <select
              id="reimbursement-status-filter"
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

          <div className="reim-field">
            <label htmlFor="reimbursement-type-filter">Type</label>
            <select
              id="reimbursement-type-filter"
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
            >
              <option value="">All types</option>
              {REIMBURSEMENT_TYPES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="reim-field">
            <label htmlFor="reimbursement-period-filter">Payroll period</label>
            <input
              id="reimbursement-period-filter"
              type="month"
              value={periodFilter}
              onChange={(event) => setPeriodFilter(event.target.value)}
            />
          </div>

          {canManage ? (
            <div className="reim-field">
              <label htmlFor="reimbursement-employee-filter">Employee</label>
              <select
                id="reimbursement-employee-filter"
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
            <div className="reim-field">
              <label htmlFor="reimbursement-tenant-id">
                Company tenant ID
              </label>
              <input
                id="reimbursement-tenant-id"
                type="text"
                value={tenantId}
                onChange={(event) => setTenantId(event.target.value)}
                placeholder="Example: sds"
              />
            </div>
          ) : null}
        </div>
      </section>

      <div className="reim-main-grid">
        <section className="reim-panel">
          <div className="reim-section-head">
            <div>
              <h2>Claims and Payments</h2>
              <p>
                {filteredItems.length} matching claim
                {filteredItems.length === 1 ? '' : 's'}
              </p>
            </div>

            {loading ? <Loader2 size={20} className="spin" /> : null}
          </div>

          {filteredItems.length ? (
            <div className="reim-record-list">
              {filteredItems.map((record) => {
                const id = recordId(record);
                const selected = id && id === recordId(selectedRecord);

                return (
                  <article
                    className={`reim-record ${selected ? 'is-selected' : ''}`}
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
                      <div className="reim-record-title">
                        <strong>
                          {safeText(
                            record.label,
                            reimbursementTypeLabel(record.type),
                          )}
                        </strong>
                        <span
                          className={`reim-status reim-status-${statusTone(
                            record.status,
                          )}`}
                        >
                          {labelFromKey(record.status)}
                        </span>
                      </div>

                      <div className="reim-record-meta">
                        <span>
                          <UserRound size={13} />
                          {safeText(record.employee_name, 'Employee')}
                          {record.employee_code
                            ? ` (${record.employee_code})`
                            : ''}
                        </span>
                        <span>
                          <ReceiptText size={13} />
                          {reimbursementTypeLabel(record.type)}
                        </span>
                        <span>
                          <CalendarDays size={13} />
                          {formatDate(record.created_at, false)}
                        </span>
                      </div>

                      {renderActionButtons(record, true)}
                    </div>

                    <div className="reim-record-amount">
                      <strong>{formatCurrency(record.claimed_amount)}</strong>
                      <small>
                        Approved: {formatCurrency(record.approved_amount)}
                      </small>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="reim-empty">
              <div>
                <ReceiptText size={34} />
                <strong>No reimbursement claims found</strong>
                <p>Create a new claim or change the selected filters.</p>
              </div>
            </div>
          )}
        </section>

        <aside className="reim-panel reim-detail">
          {loadingDetail ? (
            <div className="reim-empty">
              <div>
                <Loader2 size={30} className="spin" />
                <strong>Loading details…</strong>
              </div>
            </div>
          ) : selectedRecord ? (
            <>
              <div className="reim-detail-identity">
                <div>
                  <h2>
                    {safeText(
                      selectedRecord.label,
                      reimbursementTypeLabel(selectedRecord.type),
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
                  className={`reim-status reim-status-${statusTone(
                    selectedRecord.status,
                  )}`}
                >
                  {labelFromKey(selectedRecord.status)}
                </span>
              </div>

              <div className="reim-detail-stats">
                <article className="reim-detail-stat">
                  <span>Claimed</span>
                  <strong>
                    {formatCurrency(selectedRecord.claimed_amount)}
                  </strong>
                </article>
                <article className="reim-detail-stat">
                  <span>Approved</span>
                  <strong>
                    {formatCurrency(selectedRecord.approved_amount)}
                  </strong>
                </article>
                <article className="reim-detail-stat">
                  <span>Rejected</span>
                  <strong>
                    {formatCurrency(selectedRecord.rejected_amount)}
                  </strong>
                </article>
                <article className="reim-detail-stat">
                  <span>Tax treatment</span>
                  <strong>
                    {labelFromKey(selectedRecord.tax_treatment)}
                  </strong>
                </article>
                <article className="reim-detail-stat">
                  <span>Payment mode</span>
                  <strong>{labelFromKey(selectedRecord.payment_mode)}</strong>
                </article>
                <article className="reim-detail-stat">
                  <span>Payroll period</span>
                  <strong>{safeText(selectedRecord.payroll_period)}</strong>
                </article>
              </div>

              {selectedRecord.purpose ? (
                <div className="reim-note">
                  <strong>Purpose:</strong> {selectedRecord.purpose}
                </div>
              ) : null}

              {selectedStatus === 'rejected' ? (
                <div className="reim-warning" style={{ marginTop: 12 }}>
                  <AlertTriangle size={17} />
                  <span>
                    <strong>Rejected:</strong>{' '}
                    {safeText(selectedRecord.rejection?.reason)}
                  </span>
                </div>
              ) : null}

              {selectedStatus === 'cancelled' ? (
                <div className="reim-warning" style={{ marginTop: 12 }}>
                  <Ban size={17} />
                  <span>
                    <strong>Cancelled:</strong>{' '}
                    {safeText(selectedRecord.cancellation_reason)}
                  </span>
                </div>
              ) : null}

              {selectedRecord.payment?.amount ? (
                <div className="reim-note" style={{ marginTop: 12 }}>
                  <strong>Payment:</strong>{' '}
                  {formatCurrency(selectedRecord.payment.amount)} via{' '}
                  {labelFromKey(selectedRecord.payment.mode)} on{' '}
                  {formatDate(
                    selectedRecord.payment.payment_date ||
                      selectedRecord.payment.paid_at,
                    false,
                  )}
                  {selectedRecord.payment.payment_reference
                    ? ` · Ref: ${selectedRecord.payment.payment_reference}`
                    : ''}
                </div>
              ) : null}

              {renderActionButtons(selectedRecord)}

              <div className="reim-accordion">
                <button
                  type="button"
                  className="reim-accordion-button"
                  onClick={() => setShowItems((current) => !current)}
                >
                  <span>
                    <ReceiptText size={15} /> Expense items
                  </span>
                  {showItems ? (
                    <ChevronUp size={16} />
                  ) : (
                    <ChevronDown size={16} />
                  )}
                </button>

                {showItems ? (
                  <div className="reim-item-list">
                    {(selectedRecord.items || []).length ? (
                      selectedRecord.items.map((item, index) => (
                        <article
                          className="reim-item-card"
                          key={item.item_id || index}
                        >
                          <strong>
                            {reimbursementTypeLabel(item.type)} ·{' '}
                            {formatCurrency(item.amount)}
                          </strong>
                          <p>
                            {safeText(item.description)} ·{' '}
                            {formatDate(item.expense_date, false)}
                          </p>
                          <small>
                            Vendor: {safeText(item.vendor)} · Invoice:{' '}
                            {safeText(item.invoice_number)} · Receipts:{' '}
                            {(item.receipts || []).length}
                          </small>
                        </article>
                      ))
                    ) : (
                      <div className="reim-empty" style={{ minHeight: 100 }}>
                        No expense items available.
                      </div>
                    )}
                  </div>
                ) : null}
              </div>

              <div className="reim-accordion">
                <button
                  type="button"
                  className="reim-accordion-button"
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
                  <div className="reim-timeline">
                    {workflowHistory(selectedRecord).length ? (
                      workflowHistory(selectedRecord).map((entry, index) => (
                        <article
                          className="reim-timeline-item"
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
                      <div className="reim-empty" style={{ minHeight: 100 }}>
                        No workflow history available.
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <div className="reim-empty">
              <div>
                <UserRound size={34} />
                <strong>Select a reimbursement</strong>
                <p>
                  Open a claim to view its items, approval and payment details.
                </p>
              </div>
            </div>
          )}
        </aside>
      </div>

      {showDraftForm ? (
        <div className="reim-modal-backdrop" role="presentation">
          <div
            className="reim-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reimbursement-draft-title"
          >
            <div className="reim-modal-head">
              <div>
                <h2 id="reimbursement-draft-title">
                  {editingRecord
                    ? 'Edit Reimbursement Draft'
                    : 'Create Reimbursement Draft'}
                </h2>
                <p>
                  Add itemized expenses and receipt references before submission.
                </p>
              </div>

              <button
                type="button"
                className="reim-modal-close"
                onClick={closeDraftForm}
                aria-label="Close"
                disabled={saving}
              >
                ×
              </button>
            </div>

            <form onSubmit={saveDraft}>
              <div className="reim-modal-body">
                <div className="reim-form-grid">
                  {canManage ? (
                    <div className="reim-field reim-field-full">
                      <label htmlFor="reimbursement-employee">
                        Employee *
                      </label>
                      <select
                        id="reimbursement-employee"
                        value={draft.employee_id}
                        onChange={(event) =>
                          updateDraftField('employee_id', event.target.value)
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

                  <div className="reim-field">
                    <label htmlFor="reimbursement-type">Primary type *</label>
                    <select
                      id="reimbursement-type"
                      value={draft.type}
                      onChange={(event) =>
                        updateDraftField('type', event.target.value)
                      }
                      required
                    >
                      {REIMBURSEMENT_TYPES.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="reim-field">
                    <label htmlFor="reimbursement-label">
                      Custom label
                    </label>
                    <input
                      id="reimbursement-label"
                      type="text"
                      value={draft.label}
                      onChange={(event) =>
                        updateDraftField('label', event.target.value)
                      }
                      placeholder="Example: Client Visit Expenses"
                    />
                  </div>

                  <div className="reim-field reim-field-full">
                    <label htmlFor="reimbursement-purpose">Purpose *</label>
                    <textarea
                      id="reimbursement-purpose"
                      value={draft.purpose}
                      onChange={(event) =>
                        updateDraftField('purpose', event.target.value)
                      }
                      placeholder="Explain the business purpose of this claim."
                      required
                    />
                  </div>
                </div>

                <div className="reim-expense-items">
                  <div className="reim-expense-head">
                    <div>
                      <strong>Expense items</strong>
                      <div
                        style={{
                          color: '#64748b',
                          fontSize: 11,
                          marginTop: 3,
                        }}
                      >
                        Each item must contain a date, description and positive amount.
                      </div>
                    </div>

                    <button
                      type="button"
                      className="reim-btn reim-btn-secondary"
                      onClick={addExpenseItem}
                    >
                      <Plus size={14} />
                      Add Item
                    </button>
                  </div>

                  {draft.items.map((item, index) => (
                    <section
                      className="reim-expense-card"
                      key={`expense-${index}`}
                    >
                      <div className="reim-expense-card-head">
                        <strong>Expense Item {index + 1}</strong>
                        <button
                          type="button"
                          className="reim-icon-btn"
                          onClick={() => removeExpenseItem(index)}
                          disabled={draft.items.length === 1}
                          aria-label={`Remove expense item ${index + 1}`}
                        >
                          ×
                        </button>
                      </div>

                      <div className="reim-form-grid">
                        <div className="reim-field">
                          <label>Type *</label>
                          <select
                            value={item.type}
                            onChange={(event) =>
                              updateExpenseItem(
                                index,
                                'type',
                                event.target.value,
                              )
                            }
                          >
                            {REIMBURSEMENT_TYPES.map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="reim-field">
                          <label>Expense date *</label>
                          <input
                            type="date"
                            value={item.expense_date}
                            onChange={(event) =>
                              updateExpenseItem(
                                index,
                                'expense_date',
                                event.target.value,
                              )
                            }
                            required
                          />
                        </div>

                        <div className="reim-field reim-field-full">
                          <label>Description *</label>
                          <textarea
                            value={item.description}
                            onChange={(event) =>
                              updateExpenseItem(
                                index,
                                'description',
                                event.target.value,
                              )
                            }
                            placeholder="Describe the expense."
                            required
                          />
                        </div>

                        <div className="reim-field">
                          <label>Amount *</label>
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={item.amount}
                            onChange={(event) =>
                              updateExpenseItem(
                                index,
                                'amount',
                                event.target.value,
                              )
                            }
                            placeholder="0.00"
                            required
                          />
                        </div>

                        <div className="reim-field">
                          <label>Vendor</label>
                          <input
                            type="text"
                            value={item.vendor}
                            onChange={(event) =>
                              updateExpenseItem(
                                index,
                                'vendor',
                                event.target.value,
                              )
                            }
                            placeholder="Vendor or service provider"
                          />
                        </div>

                        <div className="reim-field">
                          <label>Invoice / bill number</label>
                          <input
                            type="text"
                            value={item.invoice_number}
                            onChange={(event) =>
                              updateExpenseItem(
                                index,
                                'invoice_number',
                                event.target.value,
                              )
                            }
                            placeholder="Invoice number"
                          />
                        </div>

                        <div className="reim-field">
                          <label>Location</label>
                          <input
                            type="text"
                            value={item.location}
                            onChange={(event) =>
                              updateExpenseItem(
                                index,
                                'location',
                                event.target.value,
                              )
                            }
                            placeholder="Expense location"
                          />
                        </div>

                        <div className="reim-field">
                          <label>Project ID</label>
                          <input
                            type="text"
                            value={item.project_id}
                            onChange={(event) =>
                              updateExpenseItem(
                                index,
                                'project_id',
                                event.target.value,
                              )
                            }
                            placeholder="Optional project ID"
                          />
                        </div>

                        <div className="reim-field">
                          <label>Project name</label>
                          <input
                            type="text"
                            value={item.project_name}
                            onChange={(event) =>
                              updateExpenseItem(
                                index,
                                'project_name',
                                event.target.value,
                              )
                            }
                            placeholder="Optional project name"
                          />
                        </div>

                        <div className="reim-field reim-field-full">
                          <label>Receipt *</label>
                          <div
                            className={`reim-receipt-box ${
                              item.receipt_reference ? 'is-attached' : ''
                            }`}
                          >
                            <div className="reim-receipt-summary">
                              {uploadingReceiptIndex === index ? (
                                <Loader2 size={20} className="spin" />
                              ) : (
                                <Paperclip size={20} />
                              )}
                              <div>
                                <strong>
                                  {item.receipt_filename ||
                                    (uploadingReceiptIndex === index
                                      ? 'Uploading receipt…'
                                      : 'No receipt attached')}
                                </strong>
                                <small>
                                  {item.receipt_reference
                                    ? [
                                        item.receipt_mime_type,
                                        formatFileSize(
                                          item.receipt_size_bytes,
                                        ),
                                      ]
                                        .filter(Boolean)
                                        .join(' · ') || 'Receipt uploaded'
                                    : 'PDF, JPG, JPEG, PNG or WEBP · maximum 8 MB'}
                                </small>
                              </div>
                            </div>

                            <div className="reim-receipt-actions">
                              <label
                                className={`reim-file-label ${
                                  uploadingReceiptIndex >= 0
                                    ? 'is-disabled'
                                    : ''
                                }`}
                                htmlFor={`reimbursement-receipt-${index}`}
                              >
                                <Paperclip size={14} />
                                {item.receipt_reference
                                  ? 'Replace Receipt'
                                  : 'Attach Receipt'}
                              </label>
                              <input
                                id={`reimbursement-receipt-${index}`}
                                className="reim-file-input"
                                type="file"
                                accept={RECEIPT_ACCEPT}
                                disabled={uploadingReceiptIndex >= 0}
                                onChange={(event) => {
                                  const file = event.target.files?.[0];
                                  event.target.value = '';

                                  if (file) {
                                    uploadReceipt(index, file);
                                  }
                                }}
                              />

                              {item.receipt_reference ? (
                                <button
                                  type="button"
                                  className="reim-btn reim-btn-danger"
                                  onClick={() => removeReceipt(index)}
                                  disabled={uploadingReceiptIndex >= 0}
                                >
                                  <XCircle size={14} />
                                  Remove
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </div>
                    </section>
                  ))}
                </div>

                <div className="reim-total">
                  <span>Claimed total</span>
                  <strong>{formatCurrency(itemAmountTotal(draft.items))}</strong>
                </div>
              </div>

              <div className="reim-modal-actions">
                <button
                  type="button"
                  className="reim-btn reim-btn-secondary"
                  onClick={closeDraftForm}
                  disabled={saving || uploadingReceiptIndex >= 0}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="reim-btn reim-btn-primary"
                  disabled={saving || uploadingReceiptIndex >= 0}
                >
                  {saving || uploadingReceiptIndex >= 0 ? (
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
        <div className="reim-modal-backdrop" role="presentation">
          <div
            className="reim-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reimbursement-action-title"
          >
            <div className="reim-modal-head">
              <div>
                <h2 id="reimbursement-action-title">
                  {actionTitle(actionModal)}
                </h2>
                <p>
                  {safeText(actionRecord.employee_name, 'Employee')} ·{' '}
                  {safeText(
                    actionRecord.label,
                    reimbursementTypeLabel(actionRecord.type),
                  )}
                </p>
              </div>

              <button
                type="button"
                className="reim-modal-close"
                onClick={closeAction}
                aria-label="Close"
                disabled={Boolean(actionLoading)}
              >
                ×
              </button>
            </div>

            <form onSubmit={executeAction}>
              <div className="reim-modal-body">
                {actionModal === 'hr_review' ? (
                  <div className="reim-warning">
                    <AlertTriangle size={17} />
                    <span>
                      Confirm that the business purpose, expense items and receipt
                      references have been checked before sending this claim to Finance.
                    </span>
                  </div>
                ) : null}

                {actionModal === 'approve' ? (
                  <>
                    <div className="reim-warning">
                      <AlertTriangle size={17} />
                      <span>
                        Tax treatment must be explicitly selected. Payroll
                        reimbursements are not reduced by LWP.
                      </span>
                    </div>

                    <div className="reim-form-grid">
                      <div className="reim-field">
                        <label htmlFor="reimbursement-approved-amount">
                          Approved amount *
                        </label>
                        <input
                          id="reimbursement-approved-amount"
                          type="number"
                          min="0.01"
                          step="0.01"
                          max={toNumber(actionRecord.claimed_amount, 0)}
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

                      <div className="reim-field">
                        <label htmlFor="reimbursement-tax-treatment">
                          Tax treatment *
                        </label>
                        <select
                          id="reimbursement-tax-treatment"
                          value={actionForm.tax_treatment}
                          onChange={(event) =>
                            updateActionField(
                              'tax_treatment',
                              event.target.value,
                            )
                          }
                          required
                        >
                          <option value="non_taxable">Non-taxable</option>
                          <option value="taxable">Taxable</option>
                        </select>
                      </div>

                      <div className="reim-field">
                        <label htmlFor="reimbursement-payment-mode">
                          Payment mode *
                        </label>
                        <select
                          id="reimbursement-payment-mode"
                          value={actionForm.payment_mode}
                          onChange={(event) =>
                            updateActionField(
                              'payment_mode',
                              event.target.value,
                            )
                          }
                          required
                        >
                          <option value="payroll">Payroll</option>
                          <option value="manual">Manual Payment</option>
                        </select>
                      </div>

                      {actionForm.payment_mode === 'payroll' ? (
                        <div className="reim-field">
                          <label htmlFor="reimbursement-payroll-period">
                            Payroll month *
                          </label>
                          <input
                            id="reimbursement-payroll-period"
                            type="month"
                            value={actionForm.payroll_period}
                            onChange={(event) =>
                              updateActionField(
                                'payroll_period',
                                event.target.value,
                              )
                            }
                            required
                          />
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : null}

                {actionModal === 'schedule' ? (
                  <div className="reim-form-grid">
                    <div className="reim-field">
                      <label htmlFor="reimbursement-revised-mode">
                        Payment mode *
                      </label>
                      <select
                        id="reimbursement-revised-mode"
                        value={actionForm.payment_mode}
                        onChange={(event) =>
                          updateActionField(
                            'payment_mode',
                            event.target.value,
                          )
                        }
                        required
                      >
                        <option value="payroll">Payroll</option>
                        <option value="manual">Manual Payment</option>
                      </select>
                    </div>

                    {actionForm.payment_mode === 'payroll' ? (
                      <div className="reim-field">
                        <label htmlFor="reimbursement-revised-period">
                          Payroll month *
                        </label>
                        <input
                          id="reimbursement-revised-period"
                          type="month"
                          value={actionForm.payroll_period}
                          onChange={(event) =>
                            updateActionField(
                              'payroll_period',
                              event.target.value,
                            )
                          }
                          required
                        />
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {actionModal === 'manual_payment' ? (
                  <div className="reim-form-grid">
                    <div className="reim-field">
                      <label htmlFor="reimbursement-payment-date">
                        Payment date *
                      </label>
                      <input
                        id="reimbursement-payment-date"
                        type="date"
                        value={actionForm.payment_date}
                        onChange={(event) =>
                          updateActionField(
                            'payment_date',
                            event.target.value,
                          )
                        }
                        required
                      />
                    </div>

                    <div className="reim-field">
                      <label htmlFor="reimbursement-manual-mode">
                        Transfer mode *
                      </label>
                      <select
                        id="reimbursement-manual-mode"
                        value={actionForm.manual_payment_mode}
                        onChange={(event) =>
                          updateActionField(
                            'manual_payment_mode',
                            event.target.value,
                          )
                        }
                        required
                      >
                        <option value="bank_transfer">Bank Transfer</option>
                        <option value="neft">NEFT</option>
                        <option value="rtgs">RTGS</option>
                        <option value="imps">IMPS</option>
                        <option value="cheque">Cheque</option>
                        <option value="cash">Cash</option>
                      </select>
                    </div>

                    <div className="reim-field reim-field-full">
                      <label htmlFor="reimbursement-payment-reference">
                        Payment reference *
                      </label>
                      <input
                        id="reimbursement-payment-reference"
                        type="text"
                        value={actionForm.payment_reference}
                        onChange={(event) =>
                          updateActionField(
                            'payment_reference',
                            event.target.value,
                          )
                        }
                        placeholder="UTR, transaction ID or cheque number"
                        required
                      />
                    </div>
                  </div>
                ) : null}

                {['reject', 'cancel'].includes(actionModal) ? (
                  <div className="reim-field">
                    <label htmlFor="reimbursement-action-reason">
                      {actionModal === 'reject'
                        ? 'Rejection reason *'
                        : 'Cancellation reason *'}
                    </label>
                    <textarea
                      id="reimbursement-action-reason"
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
                  <div className="reim-field">
                    <label htmlFor="reimbursement-action-note">
                      Action note
                    </label>
                    <textarea
                      id="reimbursement-action-note"
                      value={actionForm.note}
                      onChange={(event) =>
                        updateActionField('note', event.target.value)
                      }
                      placeholder="Optional workflow note."
                    />
                  </div>
                ) : null}
              </div>

              <div className="reim-modal-actions">
                <button
                  type="button"
                  className="reim-btn reim-btn-secondary"
                  onClick={closeAction}
                  disabled={Boolean(actionLoading)}
                >
                  Go Back
                </button>

                <button
                  type="submit"
                  className={`reim-btn ${
                    actionModal === 'reject' || actionModal === 'cancel'
                      ? 'reim-btn-danger'
                      : actionModal === 'approve' ||
                          actionModal === 'hr_review'
                        ? 'reim-btn-success'
                        : 'reim-btn-primary'
                  }`}
                  disabled={Boolean(actionLoading)}
                >
                  {actionLoading ? (
                    <Loader2 size={16} className="spin" />
                  ) : actionModal === 'approve' ||
                    actionModal === 'hr_review' ? (
                    <CheckCircle2 size={16} />
                  ) : actionModal === 'reject' ? (
                    <XCircle size={16} />
                  ) : actionModal === 'manual_payment' ? (
                    <Banknote size={16} />
                  ) : actionModal === 'schedule' ? (
                    <CalendarDays size={16} />
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