import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  Ban,
  Building2,
  Calculator,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  FileCheck2,
  FileText,
  History,
  IndianRupee,
  Landmark,
  Loader2,
  LockKeyhole,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  ShieldCheck,
  ShieldX,
  Trash2,
  UploadCloud,
  UserRound,
  UsersRound,
  WalletCards,
  XCircle,
} from 'lucide-react';

import { api } from '../api/client';
import { useCustomAlert } from '../components/CustomAlertProvider.jsx';

const DEFAULT_LIMIT = 500;

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

const FINANCE_ROLES = new Set([
  'super_admin',
  'admin',
  'finance',
  'accounts_finance',
]);

const DECLARATION_COMPONENTS = [
  ['section_80c', 'Section 80C', true],
  ['section_80ccd_1b', 'Section 80CCD(1B)', true],
  ['section_80d', 'Section 80D', true],
  ['hra_exemption', 'HRA Exemption', true],
  ['home_loan_interest', 'Home Loan Interest', true],
  ['education_loan_interest', 'Education Loan Interest', true],
  ['donations', 'Eligible Donations', true],
  ['other_deductions', 'Other Deductions', true],
  ['other_income', 'Other Income', false],
  ['previous_employer_income', 'Previous Employer Income', true],
  ['previous_employer_tds', 'Previous Employer TDS', true],
];

const DECLARATION_STATUS_FILTERS = [
  ['', 'All statuses'],
  ['draft', 'Draft'],
  ['pending_hr_review', 'Pending HR Review'],
  ['pending_finance_approval', 'Pending Finance Approval'],
  ['approved', 'Approved'],
  ['rejected', 'Rejected'],
  ['locked', 'Locked'],
  ['cancelled', 'Cancelled'],
];

const PROOF_STATUS_OPTIONS = [
  ['not_required', 'Not Required'],
  ['pending', 'Pending'],
  ['accepted', 'Accepted'],
  ['rejected', 'Rejected'],
];

const TDS_MODES = [
  ['disabled', 'Disabled'],
  ['manual', 'Manual'],
  ['external', 'External'],
];

const TDS_STATUS_FILTERS = [
  ['', 'All statuses'],
  ['draft', 'Draft'],
  ['active', 'Active'],
  ['inactive', 'Inactive'],
  ['superseded', 'Superseded'],
];

const EDITABLE_STATUSES = new Set(['draft', 'rejected']);
const REVIEWABLE_STATUSES = new Set([
  'submitted',
  'pending_hr_review',
  'pending_finance_approval',
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
  const normalized = new Set();

  const addRoleValue = (value) => {
    if (value === undefined || value === null || value === '' || value === false) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(addRoleValue);
      return;
    }

    if (typeof value === 'object') {
      const descriptor =
        value.name ||
        value.role_name ||
        value.roleName ||
        value.label ||
        value.key ||
        value.slug ||
        value.code ||
        value.role ||
        value.value;

      if (descriptor) {
        addRoleValue(descriptor);
        return;
      }

      Object.entries(value).forEach(([key, nestedValue]) => {
        if (nestedValue === true) {
          addRoleValue(key);
        } else if (nestedValue && nestedValue !== false) {
          addRoleValue(nestedValue);
        }
      });
      return;
    }

    String(value)
      .split(/[,;|]/)
      .map(normalizeKey)
      .filter(Boolean)
      .forEach((role) => normalized.add(role));
  };

  [
    user.role,
    user.roles,
    user.role_names,
    user.roleNames,
    user.role_slugs,
    user.roleSlugs,
    user.effective_roles,
    user.effectiveRoles,
    user.resolved_roles,
    user.resolvedRoles,
    user.access,
    user.access_roles,
    user.accessRoles,
    user.access_labels,
    user.accessLabels,
    user.capabilities,
    user.capability_roles,
    user.capabilityRoles,
    user.permissions?.roles,
    user.employee?.role,
    user.employee?.roles,
    user.profile?.role,
    user.profile?.roles,
    user.auth?.role,
    user.auth?.roles,
  ].forEach(addRoleValue);

  return [...normalized];
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

function recordId(record = null) {
  if (!record || typeof record !== 'object') {
    return '';
  }

  return safeText(record._id || record.id, '');
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

function currentFinancialYear() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const startYear = month >= 4 ? year : year - 1;

  return `${startYear}-${startYear + 1}`;
}

function financialYearOptions() {
  const current = Number(currentFinancialYear().slice(0, 4));
  const years = [];

  for (let start = current - 2; start <= current + 2; start += 1) {
    years.push(`${start}-${start + 1}`);
  }

  return years.reverse();
}

function emptyComponent(type, label, proofRequired) {
  return {
    component_id: '',
    type,
    label,
    description: '',
    declared_amount: '',
    approved_amount: '',
    proof_required: proofRequired,
    proof_status: proofRequired ? 'pending' : 'not_required',
    proofs: [],
    review_note: '',
  };
}

function emptyDeclarationForm(financialYear = currentFinancialYear()) {
  return {
    financial_year: financialYear,
    tax_regime: 'not_selected',
    components: [],
    employee_note: '',
    consent_confirmed: false,
  };
}

function emptyProof() {
  return {
    reference: '',
    filename: '',
    document_type: 'supporting_document',
    status: 'pending',
    note: '',
  };
}

function emptyTdsForm(financialYear = currentFinancialYear()) {
  return {
    employee_id: '',
    financial_year: financialYear,
    effective_from_period: '',
    mode: 'disabled',
    monthly_tds_amount: '',
    external_reference: '',
    source_system: '',
    note: '',
    activate: true,
  };
}

function statusTone(value) {
  const status = normalizeKey(value);

  if (['approved', 'locked', 'active'].includes(status)) {
    return 'success';
  }

  if (['rejected', 'cancelled', 'inactive'].includes(status)) {
    return 'danger';
  }

  if (['superseded'].includes(status)) {
    return 'neutral';
  }

  return 'warning';
}

function proofTone(value) {
  const status = normalizeKey(value);

  if (status === 'accepted') {
    return 'success';
  }

  if (status === 'rejected') {
    return 'danger';
  }

  if (status === 'not_required') {
    return 'neutral';
  }

  return 'warning';
}

function componentDefinition(type) {
  return (
    DECLARATION_COMPONENTS.find(([key]) => key === type) ||
    [type, labelFromKey(type), true]
  );
}

function declarationToForm(record) {
  return {
    financial_year: safeText(record.financial_year, currentFinancialYear()),
    tax_regime: normalizeKey(record.tax_regime) || 'not_selected',
    components: (record.components || []).map((component) => ({
      component_id: safeText(component.component_id, ''),
      type: normalizeKey(component.type),
      label: safeText(component.label, labelFromKey(component.type)),
      description: safeText(component.description, ''),
      declared_amount:
        component.declared_amount === undefined
          ? ''
          : String(component.declared_amount),
      approved_amount:
        component.approved_amount === undefined
          ? ''
          : String(component.approved_amount),
      proof_required: Boolean(component.proof_required),
      proof_status:
        normalizeKey(component.proof_status) ||
        (component.proof_required ? 'pending' : 'not_required'),
      proofs: (component.proofs || []).map((proof) => ({
        proof_id: safeText(proof.proof_id, ''),
        reference: safeText(proof.reference, ''),
        filename: safeText(proof.filename, ''),
        document_type:
          normalizeKey(proof.document_type) || 'supporting_document',
        status: normalizeKey(proof.status) || 'pending',
        note: safeText(proof.note, ''),
      })),
      review_note: safeText(component.review_note, ''),
    })),
    employee_note: safeText(record.employee_note, ''),
    consent_confirmed: Boolean(record.consent_confirmed),
  };
}

export default function TaxDeclarations({ user = {} }) {
  const alerts = useCustomAlert();
  const superAdmin = isSuperAdmin(user);
  const canManage = hasAnyRole(user, MANAGEMENT_ROLES);
  const canHrReview = hasAnyRole(user, HR_REVIEW_ROLES);
  const canFinance = hasAnyRole(user, FINANCE_ROLES);
  const ownEmployeeReference = getCurrentEmployeeReference(user);

  const [activeTab, setActiveTab] = useState('declarations');
  const [tenantId, setTenantId] = useState(
    safeText(user.tenant_id || user.tenant?.tenant_id || user.tenant?.code, ''),
  );
  const [financialYear, setFinancialYear] = useState(currentFinancialYear());
  const [statusFilter, setStatusFilter] = useState('');
  const [tdsStatusFilter, setTdsStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  const [employees, setEmployees] = useState([]);
  const [declarations, setDeclarations] = useState([]);
  const [tdsInstructions, setTdsInstructions] = useState([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(
    canManage ? '' : ownEmployeeReference,
  );
  const [selectedDeclaration, setSelectedDeclaration] = useState(null);
  const [selectedInstruction, setSelectedInstruction] = useState(null);
  const [taxContext, setTaxContext] = useState(null);

  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [loadingDeclarations, setLoadingDeclarations] = useState(false);
  const [loadingInstructions, setLoadingInstructions] = useState(false);
  const [loadingContext, setLoadingContext] = useState(false);
  const [savingDeclaration, setSavingDeclaration] = useState(false);
  const [savingTds, setSavingTds] = useState(false);
  const [actionLoading, setActionLoading] = useState('');

  const [showDeclarationForm, setShowDeclarationForm] = useState(false);
  const [declarationForm, setDeclarationForm] = useState(
    emptyDeclarationForm(),
  );
  const [showProofModal, setShowProofModal] = useState(false);
  const [proofComponentIndex, setProofComponentIndex] = useState(-1);
  const [proofForm, setProofForm] = useState(emptyProof());

  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewDeclaration, setReviewDeclaration] = useState(null);
  const [reviewComponents, setReviewComponents] = useState([]);
  const [reviewNote, setReviewNote] = useState('');

  const [showReasonModal, setShowReasonModal] = useState(false);
  const [reasonAction, setReasonAction] = useState('');
  const [reasonRecord, setReasonRecord] = useState(null);
  const [reasonText, setReasonText] = useState('');

  const [showTdsForm, setShowTdsForm] = useState(false);
  const [tdsForm, setTdsForm] = useState(emptyTdsForm());

  const selectedEmployee = useMemo(
    () =>
      employees.find(
        (employee) => employeeId(employee) === selectedEmployeeId,
      ) || null,
    [employees, selectedEmployeeId],
  );

  const filteredDeclarations = useMemo(() => {
    const term = normalizeKey(search);

    return declarations.filter((record) => {
      if (
        statusFilter &&
        normalizeKey(record.status) !== normalizeKey(statusFilter)
      ) {
        return false;
      }

      if (!term) {
        return true;
      }

      return [
        record.employee_name,
        record.employee_code,
        record.financial_year,
        record.tax_regime,
        record.status,
      ]
        .map(normalizeKey)
        .join(' ')
        .includes(term);
    });
  }, [declarations, search, statusFilter]);

  const filteredTdsInstructions = useMemo(() => {
    const term = normalizeKey(search);

    return tdsInstructions.filter((record) => {
      if (
        tdsStatusFilter &&
        normalizeKey(record.status) !== normalizeKey(tdsStatusFilter)
      ) {
        return false;
      }

      if (!term) {
        return true;
      }

      return [
        record.employee_name,
        record.employee_code,
        record.financial_year,
        record.effective_from_period,
        record.mode,
        record.status,
        record.external_reference,
      ]
        .map(normalizeKey)
        .join(' ')
        .includes(term);
    });
  }, [search, tdsInstructions, tdsStatusFilter]);

  const declarationMetrics = useMemo(() => {
    return {
      total: declarations.length,
      draft: declarations.filter(
        (item) => normalizeKey(item.status) === 'draft',
      ).length,
      pending: declarations.filter((item) =>
        ['pending_hr_review', 'pending_finance_approval'].includes(
          normalizeKey(item.status),
        ),
      ).length,
      approved: declarations.filter((item) =>
        ['approved', 'locked'].includes(normalizeKey(item.status)),
      ).length,
      rejected: declarations.filter(
        (item) => normalizeKey(item.status) === 'rejected',
      ).length,
    };
  }, [declarations]);

  function tenantParams() {
    if (!superAdmin || !tenantId.trim()) {
      return {};
    }

    return { tenant_id: tenantId.trim() };
  }

  function assertTenant() {
    if (superAdmin && !tenantId.trim()) {
      alerts.warning(
        'Enter the company tenant ID before accessing tax declarations.',
        'Tenant Required',
      );
      return false;
    }

    return true;
  }

  function employeeReference(record = null) {
    if (record?.employee_id) {
      return safeText(record.employee_id, '');
    }

    if (canManage) {
      return selectedEmployeeId;
    }

    return ownEmployeeReference;
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

  async function loadDeclarations({ silent = false } = {}) {
    if (!assertTenant()) {
      setDeclarations([]);
      setSelectedDeclaration(null);
      return [];
    }

    try {
      setLoadingDeclarations(true);

      const data = await api(
        `/payroll/tax-declarations${buildQuery({
          ...tenantParams(),
          financial_year: financialYear,
          status: statusFilter,
          employee_id: canManage ? '' : ownEmployeeReference,
          limit: DEFAULT_LIMIT,
        })}`,
      );
      const rows = Array.isArray(data.items)
        ? data.items
        : Array.isArray(data.declarations)
          ? data.declarations
          : [];

      setDeclarations(rows);
      setSelectedDeclaration((current) => {
        if (!rows.length) {
          return null;
        }

        if (!current) {
          return rows[0];
        }

        return (
          rows.find(
            (record) => recordId(record) === recordId(current),
          ) || rows[0]
        );
      });

      return rows;
    } catch (error) {
      setDeclarations([]);
      setSelectedDeclaration(null);

      if (!silent) {
        alerts.error(
          error.message || 'Unable to load tax declarations.',
          'Tax Declaration Load Failed',
        );
      }

      return [];
    } finally {
      setLoadingDeclarations(false);
    }
  }

  async function loadTdsInstructions({ silent = false } = {}) {
    if (!canFinance || !assertTenant()) {
      setTdsInstructions([]);
      return [];
    }

    try {
      setLoadingInstructions(true);

      const data = await api(
        `/payroll/tds-instructions${buildQuery({
          ...tenantParams(),
          financial_year: financialYear,
          status: tdsStatusFilter,
          limit: DEFAULT_LIMIT,
        })}`,
      );
      const rows = Array.isArray(data.items)
        ? data.items
        : Array.isArray(data.instructions)
          ? data.instructions
          : [];

      setTdsInstructions(rows);

      if (selectedInstruction) {
        const updated = rows.find(
          (record) => recordId(record) === recordId(selectedInstruction),
        );
        setSelectedInstruction(updated || null);
      }

      return rows;
    } catch (error) {
      setTdsInstructions([]);

      if (!silent) {
        alerts.error(
          error.message || 'Unable to load TDS instructions.',
          'TDS Instruction Load Failed',
        );
      }

      return [];
    } finally {
      setLoadingInstructions(false);
    }
  }

  async function refreshAll({ silent = false } = {}) {
    const tasks = [loadDeclarations({ silent })];

    if (canManage) {
      tasks.push(loadEmployees({ silent: true }));
    }

    if (canFinance) {
      tasks.push(loadTdsInstructions({ silent: true }));
    }

    await Promise.all(tasks);
  }

  useEffect(() => {
    if (superAdmin && !tenantId.trim()) {
      setEmployees([]);
      setDeclarations([]);
      setTdsInstructions([]);
      setTaxContext(null);
      return;
    }

    refreshAll({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, financialYear]);

  useEffect(() => {
    if (superAdmin && !tenantId.trim()) {
      return;
    }

    loadDeclarations({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  useEffect(() => {
    if (!canFinance || (superAdmin && !tenantId.trim())) {
      return;
    }

    loadTdsInstructions({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tdsStatusFilter]);

  function openCreateDeclaration(record = null) {
    if (!assertTenant()) {
      return;
    }

    const reference = record
      ? safeText(record.employee_id, '')
      : employeeReference();

    if (!reference) {
      alerts.warning('Select an employee.', 'Employee Required');
      return;
    }

    setSelectedDeclaration(record);
    setDeclarationForm(
      record
        ? declarationToForm(record)
        : emptyDeclarationForm(financialYear),
    );
    setShowDeclarationForm(true);
  }

  function closeDeclarationForm() {
    if (savingDeclaration) {
      return;
    }

    setShowDeclarationForm(false);
    setDeclarationForm(emptyDeclarationForm(financialYear));
  }

  function updateDeclarationField(field, value) {
    setDeclarationForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function addDeclarationComponent(type) {
    if (!type) {
      return;
    }

    if (
      declarationForm.components.some(
        (component) => normalizeKey(component.type) === normalizeKey(type),
      )
    ) {
      alerts.warning(
        'This declaration component has already been added.',
        'Duplicate Component',
      );
      return;
    }

    const [, label, proofRequired] = componentDefinition(type);

    setDeclarationForm((current) => ({
      ...current,
      components: [
        ...current.components,
        emptyComponent(type, label, proofRequired),
      ],
    }));
  }

  function updateComponent(index, field, value) {
    setDeclarationForm((current) => ({
      ...current,
      components: current.components.map((component, componentIndex) =>
        componentIndex === index
          ? {
              ...component,
              [field]: value,
            }
          : component,
      ),
    }));
  }

  function removeComponent(index) {
    setDeclarationForm((current) => ({
      ...current,
      components: current.components.filter(
        (_, componentIndex) => componentIndex !== index,
      ),
    }));
  }

  function openProofModal(index) {
    setProofComponentIndex(index);
    setProofForm(emptyProof());
    setShowProofModal(true);
  }

  function closeProofModal() {
    setShowProofModal(false);
    setProofComponentIndex(-1);
    setProofForm(emptyProof());
  }

  function addProof(event) {
    event.preventDefault();

    if (!proofForm.reference.trim()) {
      alerts.warning(
        'Enter the uploaded file reference, attachment ID or secure URL.',
        'Proof Reference Required',
      );
      return;
    }

    setDeclarationForm((current) => ({
      ...current,
      components: current.components.map((component, index) =>
        index === proofComponentIndex
          ? {
              ...component,
              proofs: [
                ...(component.proofs || []),
                {
                  ...proofForm,
                  reference: proofForm.reference.trim(),
                  filename: proofForm.filename.trim(),
                  note: proofForm.note.trim(),
                },
              ],
            }
          : component,
      ),
    }));

    closeProofModal();
  }

  function removeProof(componentIndex, proofIndex) {
    setDeclarationForm((current) => ({
      ...current,
      components: current.components.map((component, index) =>
        index === componentIndex
          ? {
              ...component,
              proofs: component.proofs.filter(
                (_, itemIndex) => itemIndex !== proofIndex,
              ),
            }
          : component,
      ),
    }));
  }

  function validateDeclarationForm() {
    if (
      !declarationForm.financial_year ||
      !/^\d{4}-\d{4}$/.test(declarationForm.financial_year)
    ) {
      return 'Select a valid financial year.';
    }

    if (
      !['old', 'new', 'not_selected'].includes(
        declarationForm.tax_regime,
      )
    ) {
      return 'Select a valid tax regime.';
    }

    for (const component of declarationForm.components) {
      if (toNumber(component.declared_amount, -1) < 0) {
        return `${component.label}: declared amount cannot be negative.`;
      }

      if (
        component.approved_amount !== '' &&
        toNumber(component.approved_amount, -1) < 0
      ) {
        return `${component.label}: approved amount cannot be negative.`;
      }

      if (
        component.approved_amount !== '' &&
        toNumber(component.approved_amount) >
          toNumber(component.declared_amount)
      ) {
        return `${component.label}: approved amount cannot exceed the declared amount.`;
      }
    }

    return '';
  }

  async function saveDeclaration(event) {
    event.preventDefault();

    const validationMessage = validateDeclarationForm();

    if (validationMessage) {
      alerts.warning(validationMessage, 'Declaration Validation');
      return;
    }

    const reference = employeeReference(selectedDeclaration);

    if (!reference || !assertTenant()) {
      alerts.warning('Select an employee.', 'Employee Required');
      return;
    }

    const payload = {
      ...tenantParams(),
      financial_year: declarationForm.financial_year,
      tax_regime: declarationForm.tax_regime,
      components: declarationForm.components.map((component) => ({
        component_id: component.component_id || undefined,
        type: component.type,
        label: component.label,
        description: component.description.trim(),
        declared_amount: toNumber(component.declared_amount),
        approved_amount: canHrReview
          ? toNumber(component.approved_amount)
          : 0,
        proof_required: Boolean(component.proof_required),
        proof_status: component.proof_status,
        proofs: (component.proofs || []).map((proof) => ({
          proof_id: proof.proof_id || undefined,
          reference: proof.reference.trim(),
          filename: proof.filename.trim(),
          document_type: proof.document_type,
          status: proof.status,
          note: proof.note.trim(),
        })),
        review_note: canHrReview ? component.review_note.trim() : '',
      })),
      employee_note: declarationForm.employee_note.trim(),
      consent_confirmed: Boolean(declarationForm.consent_confirmed),
    };

    try {
      setSavingDeclaration(true);

      const data = await api(
        `/payroll/tax-declarations/${encodeURIComponent(
          reference,
        )}/${encodeURIComponent(declarationForm.financial_year)}`,
        {
          method: 'PUT',
          body: JSON.stringify(payload),
        },
      );

      alerts.success(
        data.message || 'Tax declaration saved successfully.',
        'Tax Declaration Saved',
      );

      closeDeclarationForm();
      await loadDeclarations({ silent: true });
    } catch (error) {
      alerts.error(
        error.message || 'Unable to save the tax declaration.',
        'Tax Declaration Save Failed',
      );
    } finally {
      setSavingDeclaration(false);
    }
  }

  async function submitDeclaration(record) {
    const reference = employeeReference(record);

    if (!reference || !assertTenant()) {
      return;
    }

    const confirmed = await alerts.confirm(
      'Submit this tax declaration for HR review? The declaration cannot be edited while it is under review.',
      'Submit Tax Declaration',
      {
        confirmText: 'Submit Declaration',
        cancelText: 'Go Back',
      },
    );

    if (!confirmed) {
      return;
    }

    try {
      setActionLoading(`submit-${recordId(record)}`);

      const data = await api(
        `/payroll/tax-declarations/${encodeURIComponent(
          reference,
        )}/${encodeURIComponent(record.financial_year)}/submit`,
        {
          method: 'POST',
          body: JSON.stringify({
            ...tenantParams(),
            note: 'Submitted for HR review.',
          }),
        },
      );

      alerts.success(
        data.message || 'Tax declaration submitted for HR review.',
        'Declaration Submitted',
      );
      await loadDeclarations({ silent: true });
    } catch (error) {
      alerts.error(
        error.message || 'Unable to submit the tax declaration.',
        'Submission Failed',
      );
    } finally {
      setActionLoading('');
    }
  }

  function openReview(record) {
    setReviewDeclaration(record);
    setReviewComponents(
      (record.components || []).map((component) => ({
        component_id: safeText(component.component_id, ''),
        type: normalizeKey(component.type),
        label: safeText(component.label, labelFromKey(component.type)),
        declared_amount: toNumber(component.declared_amount),
        approved_amount:
          component.approved_amount === undefined
            ? toNumber(component.declared_amount)
            : toNumber(component.approved_amount),
        proof_required: Boolean(component.proof_required),
        proof_status:
          normalizeKey(component.proof_status) ||
          (component.proof_required ? 'pending' : 'not_required'),
        review_note: safeText(component.review_note, ''),
      })),
    );
    setReviewNote('');
    setShowReviewModal(true);
  }

  function closeReviewModal() {
    if (actionLoading) {
      return;
    }

    setShowReviewModal(false);
    setReviewDeclaration(null);
    setReviewComponents([]);
    setReviewNote('');
  }

  function updateReviewComponent(index, field, value) {
    setReviewComponents((current) =>
      current.map((component, componentIndex) =>
        componentIndex === index
          ? {
              ...component,
              [field]: value,
            }
          : component,
      ),
    );
  }

  async function completeHrReview(event) {
    event.preventDefault();

    const reference = employeeReference(reviewDeclaration);

    if (!reference || !assertTenant()) {
      return;
    }

    for (const component of reviewComponents) {
      if (
        toNumber(component.approved_amount) >
        toNumber(component.declared_amount)
      ) {
        alerts.warning(
          `${component.label}: approved amount cannot exceed the declared amount.`,
          'Review Validation',
        );
        return;
      }

      if (
        component.proof_required &&
        toNumber(component.approved_amount) > 0 &&
        component.proof_status !== 'accepted'
      ) {
        alerts.warning(
          `${component.label}: proof must be accepted before approving a positive amount.`,
          'Proof Review Required',
        );
        return;
      }
    }

    const confirmed = await alerts.confirm(
      'Complete HR review and send this declaration to Finance approval?',
      'Complete HR Review',
      {
        confirmText: 'Send to Finance',
        cancelText: 'Go Back',
      },
    );

    if (!confirmed) {
      return;
    }

    try {
      setActionLoading(`review-${recordId(reviewDeclaration)}`);

      const data = await api(
        `/payroll/tax-declarations/${encodeURIComponent(
          reference,
        )}/${encodeURIComponent(
          reviewDeclaration.financial_year,
        )}/hr-review`,
        {
          method: 'POST',
          body: JSON.stringify({
            ...tenantParams(),
            component_reviews: reviewComponents.map((component) => ({
              component_id: component.component_id,
              type: component.type,
              approved_amount: toNumber(component.approved_amount),
              proof_status: component.proof_status,
              review_note: component.review_note.trim(),
            })),
            note: reviewNote.trim(),
          }),
        },
      );

      alerts.success(
        data.message || 'HR review completed successfully.',
        'HR Review Completed',
      );
      closeReviewModal();
      await loadDeclarations({ silent: true });
    } catch (error) {
      alerts.error(
        error.message || 'Unable to complete HR review.',
        'HR Review Failed',
      );
    } finally {
      setActionLoading('');
    }
  }

  async function approveDeclaration(record) {
    const reference = employeeReference(record);

    if (!reference || !assertTenant()) {
      return;
    }

    const confirmed = await alerts.confirm(
      'Approve this tax declaration for payroll tax context? This does not calculate tax slabs automatically.',
      'Approve Tax Declaration',
      {
        confirmText: 'Approve Declaration',
        cancelText: 'Go Back',
      },
    );

    if (!confirmed) {
      return;
    }

    try {
      setActionLoading(`approve-${recordId(record)}`);

      const data = await api(
        `/payroll/tax-declarations/${encodeURIComponent(
          reference,
        )}/${encodeURIComponent(record.financial_year)}/approve`,
        {
          method: 'POST',
          body: JSON.stringify({
            ...tenantParams(),
            note: 'Approved by Finance.',
          }),
        },
      );

      alerts.success(
        data.message || 'Tax declaration approved successfully.',
        'Declaration Approved',
      );
      await loadDeclarations({ silent: true });
    } catch (error) {
      alerts.error(
        error.message || 'Unable to approve the declaration.',
        'Approval Failed',
      );
    } finally {
      setActionLoading('');
    }
  }

  async function lockDeclaration(record) {
    const reference = employeeReference(record);

    if (!reference || !assertTenant()) {
      return;
    }

    const confirmed = await alerts.confirm(
      'Lock this approved tax declaration? Locked declarations become immutable.',
      'Lock Tax Declaration',
      {
        confirmText: 'Lock Declaration',
        cancelText: 'Go Back',
      },
    );

    if (!confirmed) {
      return;
    }

    try {
      setActionLoading(`lock-${recordId(record)}`);

      const data = await api(
        `/payroll/tax-declarations/${encodeURIComponent(
          reference,
        )}/${encodeURIComponent(record.financial_year)}/lock`,
        {
          method: 'POST',
          body: JSON.stringify({
            ...tenantParams(),
            note: 'Locked for payroll use.',
          }),
        },
      );

      alerts.success(
        data.message || 'Tax declaration locked successfully.',
        'Declaration Locked',
      );
      await loadDeclarations({ silent: true });
    } catch (error) {
      alerts.error(
        error.message || 'Unable to lock the tax declaration.',
        'Lock Failed',
      );
    } finally {
      setActionLoading('');
    }
  }

  function openReasonAction(record, action) {
    setReasonRecord(record);
    setReasonAction(action);
    setReasonText('');
    setShowReasonModal(true);
  }

  function closeReasonModal() {
    if (actionLoading) {
      return;
    }

    setShowReasonModal(false);
    setReasonRecord(null);
    setReasonAction('');
    setReasonText('');
  }

  async function submitReasonAction(event) {
    event.preventDefault();

    if (!reasonText.trim()) {
      alerts.warning('Enter a clear reason.', 'Reason Required');
      return;
    }

    const reference = employeeReference(reasonRecord);

    if (!reference || !assertTenant()) {
      return;
    }

    const endpoint =
      reasonAction === 'reject'
        ? 'reject'
        : reasonAction === 'cancel'
          ? 'cancel'
          : '';
    const payloadKey =
      reasonAction === 'reject' ? 'reason' : 'reason';

    if (!endpoint) {
      return;
    }

    try {
      setActionLoading(`${reasonAction}-${recordId(reasonRecord)}`);

      const data = await api(
        `/payroll/tax-declarations/${encodeURIComponent(
          reference,
        )}/${encodeURIComponent(
          reasonRecord.financial_year,
        )}/${endpoint}`,
        {
          method: 'POST',
          body: JSON.stringify({
            ...tenantParams(),
            [payloadKey]: reasonText.trim(),
          }),
        },
      );

      alerts.success(
        data.message ||
          (reasonAction === 'reject'
            ? 'Tax declaration rejected.'
            : 'Tax declaration cancelled.'),
        reasonAction === 'reject'
          ? 'Declaration Rejected'
          : 'Declaration Cancelled',
      );
      closeReasonModal();
      await loadDeclarations({ silent: true });
    } catch (error) {
      alerts.error(
        error.message || 'Unable to update the tax declaration.',
        'Declaration Update Failed',
      );
    } finally {
      setActionLoading('');
    }
  }

  function openCreateTds(record = null) {
    if (!assertTenant()) {
      return;
    }

    const reference = record?.employee_id || selectedEmployeeId;

    if (!reference) {
      alerts.warning('Select an employee.', 'Employee Required');
      return;
    }

    setTdsForm({
      ...emptyTdsForm(financialYear),
      employee_id: reference,
    });
    setShowTdsForm(true);
  }

  function closeTdsForm() {
    if (savingTds) {
      return;
    }

    setShowTdsForm(false);
    setTdsForm(emptyTdsForm(financialYear));
  }

  function updateTdsField(field, value) {
    setTdsForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function saveTdsInstruction(event) {
    event.preventDefault();

    if (!tdsForm.employee_id) {
      alerts.warning('Select an employee.', 'Employee Required');
      return;
    }

    if (!tdsForm.effective_from_period) {
      alerts.warning(
        'Select the effective payroll month.',
        'Effective Month Required',
      );
      return;
    }

    if (
      tdsForm.mode === 'external' &&
      (!tdsForm.external_reference.trim() ||
        !tdsForm.source_system.trim())
    ) {
      alerts.warning(
        'External TDS requires both source system and external reference.',
        'External TDS Details Required',
      );
      return;
    }

    try {
      setSavingTds(true);

      const data = await api('/payroll/tds-instructions', {
        method: 'POST',
        body: JSON.stringify({
          ...tenantParams(),
          employee_id: tdsForm.employee_id,
          financial_year: tdsForm.financial_year,
          effective_from_period: tdsForm.effective_from_period,
          mode: tdsForm.mode,
          monthly_tds_amount:
            tdsForm.mode === 'disabled'
              ? 0
              : toNumber(tdsForm.monthly_tds_amount),
          external_reference: tdsForm.external_reference.trim(),
          source_system: tdsForm.source_system.trim(),
          note: tdsForm.note.trim(),
          activate: Boolean(tdsForm.activate),
        }),
      });

      alerts.success(
        data.message || 'TDS instruction saved successfully.',
        'TDS Instruction Saved',
      );
      closeTdsForm();
      await loadTdsInstructions({ silent: true });
    } catch (error) {
      alerts.error(
        error.message || 'Unable to save the TDS instruction.',
        'TDS Instruction Save Failed',
      );
    } finally {
      setSavingTds(false);
    }
  }

  async function changeTdsStatus(record, action) {
    const id = recordId(record);

    if (!id || !assertTenant()) {
      return;
    }

    const reason =
      action === 'deactivate'
        ? window.prompt('Enter the TDS deactivation reason:')
        : '';

    if (action === 'deactivate' && !safeText(reason, '')) {
      return;
    }

    const confirmed = await alerts.confirm(
      action === 'activate'
        ? 'Activate this TDS instruction and supersede any other active instruction for the same employee and financial year?'
        : 'Deactivate this TDS instruction?',
      action === 'activate'
        ? 'Activate TDS Instruction'
        : 'Deactivate TDS Instruction',
      {
        confirmText:
          action === 'activate' ? 'Activate' : 'Deactivate',
        cancelText: 'Go Back',
        danger: action === 'deactivate',
      },
    );

    if (!confirmed) {
      return;
    }

    try {
      setActionLoading(`${action}-${id}`);

      const data = await api(
        `/payroll/tds-instructions/${encodeURIComponent(id)}/${action}`,
        {
          method: 'POST',
          body: JSON.stringify({
            ...tenantParams(),
            reason: safeText(reason, ''),
          }),
        },
      );

      alerts.success(
        data.message || `TDS instruction ${action}d successfully.`,
        'TDS Instruction Updated',
      );
      await loadTdsInstructions({ silent: true });
    } catch (error) {
      alerts.error(
        error.message || 'Unable to update the TDS instruction.',
        'TDS Instruction Update Failed',
      );
    } finally {
      setActionLoading('');
    }
  }

  async function loadTaxContext() {
    const reference = canManage
      ? selectedEmployeeId
      : ownEmployeeReference;

    if (!reference) {
      alerts.warning('Select an employee.', 'Employee Required');
      return;
    }

    const now = new Date();
    const period = `${now.getFullYear()}-${String(
      now.getMonth() + 1,
    ).padStart(2, '0')}`;

    try {
      setLoadingContext(true);

      const data = await api(
        `/payroll/tax-context/${encodeURIComponent(
          reference,
        )}/${encodeURIComponent(period)}${buildQuery(tenantParams())}`,
      );

      setTaxContext(
        data.tax_context ||
          data.context ||
          data,
      );
    } catch (error) {
      setTaxContext(null);
      alerts.error(
        error.message || 'Unable to load payroll tax context.',
        'Tax Context Load Failed',
      );
    } finally {
      setLoadingContext(false);
    }
  }

  function renderDeclarationActions(record) {
    const status = normalizeKey(record.status);
    const loading = Boolean(actionLoading);

    return (
      <div className="taxdec-actions">
        {EDITABLE_STATUSES.has(status) ? (
          <>
            <button
              type="button"
              className="taxdec-btn taxdec-btn-secondary"
              onClick={() => openCreateDeclaration(record)}
              disabled={loading}
            >
              <Pencil size={14} />
              Edit
            </button>

            <button
              type="button"
              className="taxdec-btn taxdec-btn-primary"
              onClick={() => submitDeclaration(record)}
              disabled={loading}
            >
              <Send size={14} />
              Submit
            </button>
          </>
        ) : null}

        {status === 'pending_hr_review' && canHrReview ? (
          <button
            type="button"
            className="taxdec-btn taxdec-btn-success"
            onClick={() => openReview(record)}
            disabled={loading}
          >
            <FileCheck2 size={14} />
            HR Review
          </button>
        ) : null}

        {status === 'pending_finance_approval' && canFinance ? (
          <button
            type="button"
            className="taxdec-btn taxdec-btn-success"
            onClick={() => approveDeclaration(record)}
            disabled={loading}
          >
            <BadgeCheck size={14} />
            Approve
          </button>
        ) : null}

        {REVIEWABLE_STATUSES.has(status) &&
        (canHrReview || canFinance) ? (
          <button
            type="button"
            className="taxdec-btn taxdec-btn-danger"
            onClick={() => openReasonAction(record, 'reject')}
            disabled={loading}
          >
            <ShieldX size={14} />
            Reject
          </button>
        ) : null}

        {status === 'approved' && canFinance ? (
          <button
            type="button"
            className="taxdec-btn taxdec-btn-primary"
            onClick={() => lockDeclaration(record)}
            disabled={loading}
          >
            <LockKeyhole size={14} />
            Lock
          </button>
        ) : null}

        {!['approved', 'locked', 'cancelled'].includes(status) ? (
          <button
            type="button"
            className="taxdec-btn taxdec-btn-ghost-danger"
            onClick={() => openReasonAction(record, 'cancel')}
            disabled={loading}
          >
            <Ban size={14} />
            Cancel
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="tax-declarations-page">
      <style>{`
        .tax-declarations-page {
          display: grid;
          gap: 18px;
          min-width: 0;
          color: var(--text, #172033);
        }

        .tax-declarations-page * {
          box-sizing: border-box;
        }

        .taxdec-hero {
          position: relative;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 22px;
          overflow: hidden;
          padding: 25px;
          border: 1px solid rgba(76, 94, 201, 0.18);
          border-radius: 22px;
          background:
            radial-gradient(circle at 90% 12%, rgba(76, 94, 201, 0.16), transparent 35%),
            linear-gradient(135deg, rgba(248, 250, 255, 0.99), rgba(255, 255, 255, 0.99));
          box-shadow: 0 16px 42px rgba(15, 23, 42, 0.07);
        }

        .taxdec-hero::after {
          position: absolute;
          right: -48px;
          bottom: -75px;
          width: 210px;
          height: 210px;
          border-radius: 50%;
          background: rgba(76, 94, 201, 0.07);
          content: '';
        }

        .taxdec-hero-content,
        .taxdec-hero-actions {
          position: relative;
          z-index: 1;
        }

        .taxdec-kicker {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          margin-bottom: 8px;
          color: #4c5ec9;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .taxdec-hero h1 {
          margin: 0 0 8px;
          font-size: clamp(25px, 3vw, 36px);
          line-height: 1.1;
        }

        .taxdec-hero p {
          max-width: 840px;
          margin: 0;
          color: var(--muted, #64748b);
          line-height: 1.65;
        }

        .taxdec-hero-actions {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 10px;
        }

        .taxdec-btn {
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

        .taxdec-btn:hover:not(:disabled) {
          transform: translateY(-1px);
        }

        .taxdec-btn:disabled {
          cursor: not-allowed;
          opacity: 0.55;
        }

        .taxdec-btn-primary {
          color: #fff;
          background: #4c5ec9;
          border-color: #4c5ec9;
        }

        .taxdec-btn-success {
          color: #fff;
          background: #07875f;
          border-color: #07875f;
        }

        .taxdec-btn-danger {
          color: #fff;
          background: #c9364b;
          border-color: #c9364b;
        }

        .taxdec-btn-secondary {
          color: #27324a;
          background: #fff;
          border-color: var(--border, #dfe5ee);
        }

        .taxdec-btn-ghost-danger {
          color: #b4233a;
          background: rgba(201, 54, 75, 0.06);
          border-color: rgba(201, 54, 75, 0.18);
        }

        .taxdec-tabs {
          display: flex;
          gap: 8px;
          overflow-x: auto;
          padding: 6px;
          border: 1px solid var(--border, #dfe5ee);
          border-radius: 15px;
          background: var(--card, #fff);
        }

        .taxdec-tab {
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

        .taxdec-tab.is-active {
          color: #fff;
          background: #4c5ec9;
        }

        .taxdec-warning {
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

        .taxdec-metrics {
          display: grid;
          grid-template-columns: repeat(5, minmax(145px, 1fr));
          gap: 13px;
        }

        .taxdec-metric {
          min-width: 0;
          padding: 17px;
          border: 1px solid var(--border, #dfe5ee);
          border-radius: 16px;
          background: var(--card, #fff);
          box-shadow: 0 10px 28px rgba(15, 23, 42, 0.05);
        }

        .taxdec-metric-head {
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

        .taxdec-metric strong {
          display: block;
          overflow: hidden;
          font-size: clamp(22px, 2.5vw, 30px);
          line-height: 1.15;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .taxdec-panel {
          min-width: 0;
          padding: 20px;
          border: 1px solid var(--border, #dfe5ee);
          border-radius: 18px;
          background: var(--card, #fff);
          box-shadow: 0 12px 32px rgba(15, 23, 42, 0.055);
        }

        .taxdec-section-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          margin-bottom: 16px;
        }

        .taxdec-section-head h2,
        .taxdec-section-head h3 {
          margin: 0 0 5px;
          font-size: 19px;
        }

        .taxdec-section-head p {
          margin: 0;
          color: var(--muted, #64748b);
          font-size: 13px;
          line-height: 1.5;
        }

        .taxdec-toolbar {
          display: grid;
          grid-template-columns: minmax(240px, 1.2fr) repeat(4, minmax(150px, 0.7fr));
          gap: 12px;
          align-items: end;
        }

        .taxdec-field {
          display: grid;
          gap: 7px;
          min-width: 0;
        }

        .taxdec-field label {
          color: #465269;
          font-size: 12px;
          font-weight: 850;
        }

        .taxdec-field input,
        .taxdec-field select,
        .taxdec-field textarea {
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

        .taxdec-field textarea {
          min-height: 92px;
          resize: vertical;
          line-height: 1.5;
        }

        .taxdec-field input:focus,
        .taxdec-field select:focus,
        .taxdec-field textarea:focus {
          border-color: #5e6fd2;
          box-shadow: 0 0 0 3px rgba(76, 94, 201, 0.11);
        }

        .taxdec-field-full {
          grid-column: 1 / -1;
        }

        .taxdec-checkbox {
          display: flex;
          align-items: center;
          gap: 8px;
          min-height: 42px;
          color: #465269;
          font-size: 13px;
          font-weight: 750;
        }

        .taxdec-checkbox input {
          width: 17px;
          height: 17px;
        }

        .taxdec-search-wrap {
          position: relative;
        }

        .taxdec-search-wrap svg {
          position: absolute;
          top: 50%;
          left: 12px;
          color: #8a96aa;
          transform: translateY(-50%);
          pointer-events: none;
        }

        .taxdec-search-wrap input {
          padding-left: 38px;
        }

        .taxdec-main-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.35fr) minmax(330px, 0.65fr);
          gap: 18px;
          align-items: start;
        }

        .taxdec-list {
          display: grid;
          gap: 11px;
        }

        .taxdec-row {
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

        .taxdec-row:hover {
          border-color: rgba(76, 94, 201, 0.45);
          box-shadow: 0 10px 26px rgba(35, 48, 80, 0.08);
          transform: translateY(-1px);
        }

        .taxdec-row.is-selected {
          border-color: #4c5ec9;
          box-shadow: 0 0 0 3px rgba(76, 94, 201, 0.1);
        }

        .taxdec-row-title {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
          margin-bottom: 7px;
        }

        .taxdec-row-title strong {
          font-size: 15px;
        }

        .taxdec-row-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 7px 14px;
          color: var(--muted, #64748b);
          font-size: 12px;
        }

        .taxdec-row-meta span {
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }

        .taxdec-row-end {
          min-width: 155px;
          text-align: right;
        }

        .taxdec-row-end strong {
          display: block;
          margin-bottom: 4px;
          font-size: 15px;
        }

        .taxdec-row-end small {
          color: var(--muted, #64748b);
          font-size: 11px;
        }

        .taxdec-status {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 5px 9px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 900;
          white-space: nowrap;
        }

        .taxdec-status-success {
          color: #047857;
          background: rgba(5, 150, 105, 0.1);
        }

        .taxdec-status-danger {
          color: #b4233a;
          background: rgba(201, 54, 75, 0.1);
        }

        .taxdec-status-warning {
          color: #9a5b00;
          background: rgba(245, 158, 11, 0.13);
        }

        .taxdec-status-neutral {
          color: #475569;
          background: rgba(100, 116, 139, 0.12);
        }

        .taxdec-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 14px;
        }

        .taxdec-actions .taxdec-btn {
          min-height: 34px;
          padding: 7px 10px;
          font-size: 12px;
        }

        .taxdec-detail {
          position: sticky;
          top: 18px;
          min-width: 0;
        }

        .taxdec-detail-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          padding-bottom: 15px;
          border-bottom: 1px solid var(--border, #e3e7ef);
        }

        .taxdec-detail-head h2 {
          margin: 0 0 5px;
          font-size: 20px;
        }

        .taxdec-detail-head p {
          margin: 0;
          color: var(--muted, #64748b);
          font-size: 13px;
        }

        .taxdec-detail-stats {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin: 15px 0;
        }

        .taxdec-detail-stat {
          min-width: 0;
          padding: 12px;
          border-radius: 12px;
          background: rgba(148, 163, 184, 0.09);
        }

        .taxdec-detail-stat span {
          display: block;
          margin-bottom: 4px;
          color: var(--muted, #64748b);
          font-size: 11px;
          font-weight: 850;
          text-transform: uppercase;
        }

        .taxdec-detail-stat strong {
          display: block;
          overflow: hidden;
          font-size: 14px;
          text-overflow: ellipsis;
        }

        .taxdec-components {
          display: grid;
          gap: 9px;
          margin-top: 14px;
        }

        .taxdec-component {
          padding: 12px;
          border: 1px solid var(--border, #dfe5ee);
          border-radius: 12px;
        }

        .taxdec-component-head {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 7px;
        }

        .taxdec-component-head strong {
          font-size: 13px;
        }

        .taxdec-component-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
          color: var(--muted, #64748b);
          font-size: 11px;
        }

        .taxdec-timeline {
          display: grid;
          gap: 0;
          max-height: 310px;
          overflow: auto;
          margin-top: 14px;
          padding: 4px 13px;
          border: 1px solid var(--border, #dfe5ee);
          border-radius: 13px;
        }

        .taxdec-timeline-item {
          padding: 11px 0;
          border-bottom: 1px solid rgba(226, 232, 240, 0.9);
        }

        .taxdec-timeline-item:last-child {
          border-bottom: 0;
        }

        .taxdec-timeline-item strong {
          display: block;
          margin-bottom: 3px;
          font-size: 12px;
        }

        .taxdec-timeline-item p,
        .taxdec-timeline-item small {
          display: block;
          margin: 0;
          color: var(--muted, #64748b);
          font-size: 11px;
          line-height: 1.45;
        }

        .taxdec-empty {
          display: grid;
          place-items: center;
          min-height: 220px;
          padding: 30px;
          border: 1px dashed var(--border, #d7dee9);
          border-radius: 15px;
          color: var(--muted, #64748b);
          text-align: center;
        }

        .taxdec-empty svg {
          margin-bottom: 10px;
          opacity: 0.6;
        }

        .taxdec-table-wrap {
          overflow-x: auto;
        }

        .taxdec-table {
          width: 100%;
          min-width: 980px;
          border-collapse: collapse;
        }

        .taxdec-table th,
        .taxdec-table td {
          padding: 12px 11px;
          border-bottom: 1px solid #e7ebf1;
          text-align: left;
          vertical-align: top;
          font-size: 12px;
        }

        .taxdec-table th {
          color: #58647a;
          background: rgba(148, 163, 184, 0.07);
          font-size: 10px;
          font-weight: 900;
          text-transform: uppercase;
        }

        .taxdec-table td strong {
          display: block;
          margin-bottom: 3px;
        }

        .taxdec-table td small {
          color: var(--muted, #64748b);
        }

        .taxdec-context {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
        }

        .taxdec-context-card {
          padding: 15px;
          border: 1px solid var(--border, #dfe5ee);
          border-radius: 14px;
          background: #fff;
        }

        .taxdec-context-card span {
          display: block;
          margin-bottom: 6px;
          color: var(--muted, #64748b);
          font-size: 10px;
          font-weight: 850;
          text-transform: uppercase;
        }

        .taxdec-context-card strong {
          display: block;
          margin-bottom: 4px;
          font-size: 15px;
        }

        .taxdec-context-card small {
          color: var(--muted, #64748b);
          line-height: 1.45;
        }

        .taxdec-modal-backdrop {
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

        .taxdec-modal {
          width: min(900px, 100%);
          max-height: calc(100vh - 44px);
          overflow: auto;
          border: 1px solid rgba(255, 255, 255, 0.35);
          border-radius: 20px;
          background: #fff;
          box-shadow: 0 30px 90px rgba(15, 23, 42, 0.3);
        }

        .taxdec-modal.is-small {
          width: min(620px, 100%);
        }

        .taxdec-modal-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          padding: 20px 22px 14px;
          border-bottom: 1px solid #e4e8ef;
        }

        .taxdec-modal-head h2 {
          margin: 0 0 4px;
          font-size: 21px;
        }

        .taxdec-modal-head p {
          margin: 0;
          color: #64748b;
          font-size: 13px;
        }

        .taxdec-modal-close {
          width: 38px;
          height: 38px;
          border: 1px solid #dfe5ee;
          border-radius: 10px;
          background: #fff;
          color: #334155;
          cursor: pointer;
        }

        .taxdec-modal-body {
          display: grid;
          gap: 15px;
          padding: 20px 22px;
        }

        .taxdec-form-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 13px;
        }

        .taxdec-form-component {
          display: grid;
          gap: 12px;
          padding: 15px;
          border: 1px solid var(--border, #dfe5ee);
          border-radius: 14px;
        }

        .taxdec-form-component-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
        }

        .taxdec-form-component-head h3 {
          margin: 0 0 4px;
          font-size: 16px;
        }

        .taxdec-form-component-head p {
          margin: 0;
          color: var(--muted, #64748b);
          font-size: 11px;
        }

        .taxdec-proof-list {
          display: grid;
          gap: 8px;
        }

        .taxdec-proof-item {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          padding: 10px;
          border-radius: 10px;
          background: rgba(148, 163, 184, 0.08);
        }

        .taxdec-proof-item strong {
          display: block;
          margin-bottom: 3px;
          font-size: 12px;
        }

        .taxdec-proof-item small {
          display: block;
          color: var(--muted, #64748b);
          font-size: 10px;
        }

        .taxdec-modal-actions {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 10px;
          padding: 14px 22px 20px;
          border-top: 1px solid #e4e8ef;
        }

        .spin {
          animation: taxdec-spin 0.9s linear infinite;
        }

        @keyframes taxdec-spin {
          to {
            transform: rotate(360deg);
          }
        }

        @media (max-width: 1220px) {
          .taxdec-metrics {
            grid-template-columns: repeat(3, minmax(145px, 1fr));
          }

          .taxdec-toolbar {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .taxdec-main-grid {
            grid-template-columns: 1fr;
          }

          .taxdec-detail {
            position: static;
          }
        }

        @media (max-width: 860px) {
          .taxdec-toolbar,
          .taxdec-context {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 760px) {
          .taxdec-hero {
            flex-direction: column;
            padding: 20px;
          }

          .taxdec-hero-actions {
            width: 100%;
            justify-content: stretch;
          }

          .taxdec-hero-actions .taxdec-btn {
            flex: 1;
          }

          .taxdec-metrics,
          .taxdec-toolbar,
          .taxdec-form-grid,
          .taxdec-context {
            grid-template-columns: 1fr;
          }

          .taxdec-row {
            grid-template-columns: 1fr;
          }

          .taxdec-row-end {
            text-align: left;
          }

          .taxdec-component-grid {
            grid-template-columns: 1fr;
          }

          .taxdec-modal-backdrop {
            align-items: end;
            padding: 0;
          }

          .taxdec-modal {
            max-height: 94vh;
            border-radius: 20px 20px 0 0;
          }

          .taxdec-modal-head,
          .taxdec-modal-body,
          .taxdec-modal-actions {
            padding-left: 16px;
            padding-right: 16px;
          }
        }
      `}</style>

      <header className="taxdec-hero">
        <div className="taxdec-hero-content">
          <span className="taxdec-kicker">
            <Calculator size={15} />
            Payroll Tax Controls
          </span>
          <h1>Tax Declarations & TDS</h1>
          <p>
            Collect employee declarations, review supporting proofs, approve
            tax inputs and manage disabled, manual or external monthly TDS
            instructions without performing automatic income-tax slab
            calculations.
          </p>
        </div>

        <div className="taxdec-hero-actions">
          <button
            type="button"
            className="taxdec-btn taxdec-btn-secondary"
            onClick={() => refreshAll()}
            disabled={
              loadingEmployees ||
              loadingDeclarations ||
              loadingInstructions
            }
          >
            {loadingEmployees ||
            loadingDeclarations ||
            loadingInstructions ? (
              <Loader2 size={17} className="spin" />
            ) : (
              <RefreshCw size={17} />
            )}
            Refresh
          </button>

          <button
            type="button"
            className="taxdec-btn taxdec-btn-primary"
            onClick={() => openCreateDeclaration()}
          >
            <Plus size={17} />
            New Declaration
          </button>

          {canFinance ? (
            <button
              type="button"
              className="taxdec-btn taxdec-btn-success"
              onClick={() => openCreateTds()}
            >
              <CircleDollarSign size={17} />
              New TDS Instruction
            </button>
          ) : null}
        </div>
      </header>

      <div className="taxdec-warning">
        <AlertTriangle size={18} />
        <span>
          <strong>Automatic tax-slab calculation is disabled.</strong> Payroll
          uses only approved declaration context plus an active Disabled,
          Manual or External TDS instruction.
        </span>
      </div>

      <nav className="taxdec-tabs" aria-label="Tax declaration sections">
        <button
          type="button"
          className={`taxdec-tab ${
            activeTab === 'declarations' ? 'is-active' : ''
          }`}
          onClick={() => setActiveTab('declarations')}
        >
          <FileText size={16} />
          Tax Declarations
        </button>

        {canFinance ? (
          <button
            type="button"
            className={`taxdec-tab ${
              activeTab === 'tds' ? 'is-active' : ''
            }`}
            onClick={() => setActiveTab('tds')}
          >
            <IndianRupee size={16} />
            TDS Instructions
          </button>
        ) : null}

        <button
          type="button"
          className={`taxdec-tab ${
            activeTab === 'context' ? 'is-active' : ''
          }`}
          onClick={() => setActiveTab('context')}
        >
          <ShieldCheck size={16} />
          Payroll Tax Context
        </button>
      </nav>

      <section className="taxdec-panel">
        <div className="taxdec-toolbar">
          <div className="taxdec-field">
            <label htmlFor="taxdec-search">Search</label>
            <div className="taxdec-search-wrap">
              <Search size={16} />
              <input
                id="taxdec-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Employee, status, regime or reference"
              />
            </div>
          </div>

          <div className="taxdec-field">
            <label htmlFor="taxdec-financial-year">
              Financial year
            </label>
            <select
              id="taxdec-financial-year"
              value={financialYear}
              onChange={(event) => setFinancialYear(event.target.value)}
            >
              {financialYearOptions().map((year) => (
                <option key={year} value={year}>
                  FY {year}
                </option>
              ))}
            </select>
          </div>

          {activeTab === 'declarations' ? (
            <div className="taxdec-field">
              <label htmlFor="taxdec-status-filter">
                Declaration status
              </label>
              <select
                id="taxdec-status-filter"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                {DECLARATION_STATUS_FILTERS.map(([value, label]) => (
                  <option key={value || 'all'} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {activeTab === 'tds' && canFinance ? (
            <div className="taxdec-field">
              <label htmlFor="taxdec-tds-status-filter">
                TDS status
              </label>
              <select
                id="taxdec-tds-status-filter"
                value={tdsStatusFilter}
                onChange={(event) =>
                  setTdsStatusFilter(event.target.value)
                }
              >
                {TDS_STATUS_FILTERS.map(([value, label]) => (
                  <option key={value || 'all'} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {canManage ? (
            <div className="taxdec-field">
              <label htmlFor="taxdec-employee-select">
                Selected employee
              </label>
              <select
                id="taxdec-employee-select"
                value={selectedEmployeeId}
                onChange={(event) =>
                  setSelectedEmployeeId(event.target.value)
                }
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

          {superAdmin ? (
            <div className="taxdec-field">
              <label htmlFor="taxdec-tenant-id">
                Company tenant ID
              </label>
              <input
                id="taxdec-tenant-id"
                type="text"
                value={tenantId}
                onChange={(event) => setTenantId(event.target.value)}
                placeholder="Example: sds"
              />
            </div>
          ) : null}
        </div>
      </section>

      {activeTab === 'declarations' ? (
        <>
          <section className="taxdec-metrics">
            <article className="taxdec-metric">
              <div className="taxdec-metric-head">
                <span>Total</span>
                <UsersRound size={17} />
              </div>
              <strong>{declarationMetrics.total}</strong>
            </article>

            <article className="taxdec-metric">
              <div className="taxdec-metric-head">
                <span>Draft</span>
                <Pencil size={17} />
              </div>
              <strong>{declarationMetrics.draft}</strong>
            </article>

            <article className="taxdec-metric">
              <div className="taxdec-metric-head">
                <span>Pending</span>
                <History size={17} />
              </div>
              <strong>{declarationMetrics.pending}</strong>
            </article>

            <article className="taxdec-metric">
              <div className="taxdec-metric-head">
                <span>Approved</span>
                <BadgeCheck size={17} />
              </div>
              <strong>{declarationMetrics.approved}</strong>
            </article>

            <article className="taxdec-metric">
              <div className="taxdec-metric-head">
                <span>Rejected</span>
                <ShieldX size={17} />
              </div>
              <strong>{declarationMetrics.rejected}</strong>
            </article>
          </section>

          <div className="taxdec-main-grid">
            <section className="taxdec-panel">
              <div className="taxdec-section-head">
                <div>
                  <h2>Tax Declarations</h2>
                  <p>
                    {filteredDeclarations.length} matching declaration
                    {filteredDeclarations.length === 1 ? '' : 's'}
                  </p>
                </div>

                {loadingDeclarations ? (
                  <Loader2 size={20} className="spin" />
                ) : null}
              </div>

              {filteredDeclarations.length ? (
                <div className="taxdec-list">
                  {filteredDeclarations.map((record) => {
                    const selected =
                      recordId(record) === recordId(selectedDeclaration);

                    return (
                      <article
                        className={`taxdec-row ${
                          selected ? 'is-selected' : ''
                        }`}
                        key={recordId(record)}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedDeclaration(record)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setSelectedDeclaration(record);
                          }
                        }}
                      >
                        <div>
                          <div className="taxdec-row-title">
                            <strong>
                              {safeText(record.employee_name, 'Employee')}
                            </strong>
                            <span
                              className={`taxdec-status taxdec-status-${statusTone(
                                record.status,
                              )}`}
                            >
                              {labelFromKey(record.status)}
                            </span>
                          </div>

                          <div className="taxdec-row-meta">
                            <span>
                              <UserRound size={13} />
                              {safeText(record.employee_code)}
                            </span>
                            <span>
                              <CalendarDays size={13} />
                              FY {safeText(record.financial_year)}
                            </span>
                            <span>
                              <Calculator size={13} />
                              {labelFromKey(record.tax_regime)} Regime
                            </span>
                          </div>

                          {renderDeclarationActions(record)}
                        </div>

                        <div className="taxdec-row-end">
                          <strong>
                            {formatCurrency(record.declared_total)}
                          </strong>
                          <small>
                            Approved: {formatCurrency(record.approved_total)}
                          </small>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="taxdec-empty">
                  <div>
                    <FileText size={34} />
                    <strong>No tax declarations found</strong>
                    <p>
                      Create a declaration or change the selected filters.
                    </p>
                  </div>
                </div>
              )}
            </section>

            <aside className="taxdec-panel taxdec-detail">
              {selectedDeclaration ? (
                <>
                  <div className="taxdec-detail-head">
                    <div>
                      <h2>
                        {safeText(
                          selectedDeclaration.employee_name,
                          'Employee Declaration',
                        )}
                      </h2>
                      <p>
                        {safeText(selectedDeclaration.employee_code)} · FY{' '}
                        {safeText(selectedDeclaration.financial_year)}
                      </p>
                    </div>

                    <span
                      className={`taxdec-status taxdec-status-${statusTone(
                        selectedDeclaration.status,
                      )}`}
                    >
                      {labelFromKey(selectedDeclaration.status)}
                    </span>
                  </div>

                  <div className="taxdec-detail-stats">
                    <article className="taxdec-detail-stat">
                      <span>Tax regime</span>
                      <strong>
                        {labelFromKey(selectedDeclaration.tax_regime)}
                      </strong>
                    </article>
                    <article className="taxdec-detail-stat">
                      <span>Revision</span>
                      <strong>
                        #{toNumber(selectedDeclaration.revision_number, 1)}
                      </strong>
                    </article>
                    <article className="taxdec-detail-stat">
                      <span>Declared total</span>
                      <strong>
                        {formatCurrency(selectedDeclaration.declared_total)}
                      </strong>
                    </article>
                    <article className="taxdec-detail-stat">
                      <span>Approved total</span>
                      <strong>
                        {formatCurrency(selectedDeclaration.approved_total)}
                      </strong>
                    </article>
                  </div>

                  {selectedDeclaration.rejection_reason ? (
                    <div className="taxdec-warning">
                      <ShieldX size={17} />
                      <span>
                        <strong>Rejected:</strong>{' '}
                        {selectedDeclaration.rejection_reason}
                      </span>
                    </div>
                  ) : null}

                  <div className="taxdec-components">
                    {(selectedDeclaration.components || []).map(
                      (component) => (
                        <article
                          className="taxdec-component"
                          key={
                            component.component_id ||
                            component.type
                          }
                        >
                          <div className="taxdec-component-head">
                            <strong>
                              {safeText(
                                component.label,
                                labelFromKey(component.type),
                              )}
                            </strong>
                            <span
                              className={`taxdec-status taxdec-status-${proofTone(
                                component.proof_status,
                              )}`}
                            >
                              {labelFromKey(component.proof_status)}
                            </span>
                          </div>

                          <div className="taxdec-component-grid">
                            <span>
                              Declared:{' '}
                              <strong>
                                {formatCurrency(component.declared_amount)}
                              </strong>
                            </span>
                            <span>
                              Approved:{' '}
                              <strong>
                                {formatCurrency(component.approved_amount)}
                              </strong>
                            </span>
                            <span>
                              Proofs:{' '}
                              <strong>
                                {(component.proofs || []).length}
                              </strong>
                            </span>
                            <span>
                              Required:{' '}
                              <strong>
                                {component.proof_required ? 'Yes' : 'No'}
                              </strong>
                            </span>
                          </div>
                        </article>
                      ),
                    )}
                  </div>

                  {renderDeclarationActions(selectedDeclaration)}

                  {Array.isArray(
                    selectedDeclaration.workflow_history,
                  ) &&
                  selectedDeclaration.workflow_history.length ? (
                    <div className="taxdec-timeline">
                      {[...selectedDeclaration.workflow_history]
                        .reverse()
                        .map((entry, index) => (
                          <article
                            className="taxdec-timeline-item"
                            key={`${safeText(entry.at, index)}-${index}`}
                          >
                            <strong>{labelFromKey(entry.action)}</strong>
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
                <div className="taxdec-empty">
                  <div>
                    <FileText size={34} />
                    <strong>Select a declaration</strong>
                    <p>
                      Select a declaration to view its components and workflow.
                    </p>
                  </div>
                </div>
              )}
            </aside>
          </div>
        </>
      ) : null}

      {activeTab === 'tds' && canFinance ? (
        <section className="taxdec-panel">
          <div className="taxdec-section-head">
            <div>
              <h2>TDS Instructions</h2>
              <p>
                Active instructions determine monthly payroll TDS. New active
                instructions supersede older active instructions for the same
                employee and financial year.
              </p>
            </div>

            {loadingInstructions ? (
              <Loader2 size={20} className="spin" />
            ) : null}
          </div>

          {filteredTdsInstructions.length ? (
            <div className="taxdec-table-wrap">
              <table className="taxdec-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Financial year</th>
                    <th>Effective month</th>
                    <th>Mode</th>
                    <th>Monthly TDS</th>
                    <th>External source</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTdsInstructions.map((record) => (
                    <tr key={recordId(record)}>
                      <td>
                        <strong>{safeText(record.employee_name)}</strong>
                        <small>{safeText(record.employee_code)}</small>
                      </td>
                      <td>{safeText(record.financial_year)}</td>
                      <td>{safeText(record.effective_from_period)}</td>
                      <td>{labelFromKey(record.mode)}</td>
                      <td>
                        {formatCurrency(record.monthly_tds_amount)}
                      </td>
                      <td>
                        <strong>
                          {safeText(record.source_system)}
                        </strong>
                        <small>
                          {safeText(record.external_reference)}
                        </small>
                      </td>
                      <td>
                        <span
                          className={`taxdec-status taxdec-status-${statusTone(
                            record.status,
                          )}`}
                        >
                          {labelFromKey(record.status)}
                        </span>
                      </td>
                      <td>{formatDate(record.created_at)}</td>
                      <td>
                        <div className="taxdec-actions">
                          {['draft', 'inactive'].includes(
                            normalizeKey(record.status),
                          ) ? (
                            <button
                              type="button"
                              className="taxdec-btn taxdec-btn-success"
                              onClick={() =>
                                changeTdsStatus(record, 'activate')
                              }
                              disabled={Boolean(actionLoading)}
                            >
                              <CheckCircle2 size={14} />
                              Activate
                            </button>
                          ) : null}

                          {['draft', 'active'].includes(
                            normalizeKey(record.status),
                          ) ? (
                            <button
                              type="button"
                              className="taxdec-btn taxdec-btn-danger"
                              onClick={() =>
                                changeTdsStatus(record, 'deactivate')
                              }
                              disabled={Boolean(actionLoading)}
                            >
                              <Ban size={14} />
                              Deactivate
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="taxdec-empty">
              <div>
                <IndianRupee size={34} />
                <strong>No TDS instructions found</strong>
                <p>
                  Create an instruction or change the selected filters.
                </p>
              </div>
            </div>
          )}
        </section>
      ) : null}

      {activeTab === 'context' ? (
        <section className="taxdec-panel">
          <div className="taxdec-section-head">
            <div>
              <h2>Current Payroll Tax Context</h2>
              <p>
                View the declaration snapshot and TDS instruction that payroll
                will use for the current month.
              </p>
            </div>

            <button
              type="button"
              className="taxdec-btn taxdec-btn-primary"
              onClick={loadTaxContext}
              disabled={loadingContext}
            >
              {loadingContext ? (
                <Loader2 size={16} className="spin" />
              ) : (
                <RefreshCw size={16} />
              )}
              Resolve Context
            </button>
          </div>

          {taxContext ? (
            <div className="taxdec-context">
              <article className="taxdec-context-card">
                <span>Employee</span>
                <strong>{safeText(taxContext.employee_name)}</strong>
                <small>{safeText(taxContext.employee_code)}</small>
              </article>

              <article className="taxdec-context-card">
                <span>Financial year</span>
                <strong>{safeText(taxContext.financial_year)}</strong>
                <small>Period: {safeText(taxContext.period_key)}</small>
              </article>

              <article className="taxdec-context-card">
                <span>Tax regime</span>
                <strong>
                  {labelFromKey(
                    taxContext.declaration?.tax_regime,
                  )}
                </strong>
                <small>
                  Declaration:{' '}
                  {labelFromKey(taxContext.declaration?.status)}
                </small>
              </article>

              <article className="taxdec-context-card">
                <span>Approved declarations</span>
                <strong>
                  {formatCurrency(
                    taxContext.declaration?.approved_total,
                  )}
                </strong>
                <small>
                  Revision #
                  {toNumber(
                    taxContext.declaration?.revision_number,
                    0,
                  )}
                </small>
              </article>

              <article className="taxdec-context-card">
                <span>TDS mode</span>
                <strong>
                  {labelFromKey(taxContext.tds?.mode)}
                </strong>
                <small>
                  Instruction:{' '}
                  {safeText(taxContext.tds?.instruction_id)}
                </small>
              </article>

              <article className="taxdec-context-card">
                <span>Monthly TDS</span>
                <strong>
                  {formatCurrency(taxContext.tds?.tds_amount)}
                </strong>
                <small>
                  Effective:{' '}
                  {safeText(
                    taxContext.tds?.effective_from_period,
                  )}
                </small>
              </article>
            </div>
          ) : (
            <div className="taxdec-empty">
              <div>
                <ShieldCheck size={34} />
                <strong>No tax context resolved</strong>
                <p>
                  Select an employee where applicable, then resolve the current
                  payroll tax context.
                </p>
              </div>
            </div>
          )}
        </section>
      ) : null}

      {showDeclarationForm ? (
        <div className="taxdec-modal-backdrop" role="presentation">
          <div
            className="taxdec-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="taxdec-form-title"
          >
            <div className="taxdec-modal-head">
              <div>
                <h2 id="taxdec-form-title">
                  {selectedDeclaration
                    ? 'Update Tax Declaration'
                    : 'New Tax Declaration'}
                </h2>
                <p>
                  Employee:{' '}
                  {safeText(
                    selectedDeclaration?.employee_name ||
                      employeeName(selectedEmployee || {}),
                    canManage ? 'Selected employee' : 'My declaration',
                  )}
                </p>
              </div>

              <button
                type="button"
                className="taxdec-modal-close"
                onClick={closeDeclarationForm}
                aria-label="Close"
                disabled={savingDeclaration}
              >
                ×
              </button>
            </div>

            <form onSubmit={saveDeclaration}>
              <div className="taxdec-modal-body">
                <div className="taxdec-form-grid">
                  <div className="taxdec-field">
                    <label htmlFor="taxdec-form-year">
                      Financial year *
                    </label>
                    <select
                      id="taxdec-form-year"
                      value={declarationForm.financial_year}
                      onChange={(event) =>
                        updateDeclarationField(
                          'financial_year',
                          event.target.value,
                        )
                      }
                      disabled={Boolean(selectedDeclaration)}
                    >
                      {financialYearOptions().map((year) => (
                        <option key={year} value={year}>
                          FY {year}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="taxdec-field">
                    <label htmlFor="taxdec-form-regime">
                      Tax regime *
                    </label>
                    <select
                      id="taxdec-form-regime"
                      value={declarationForm.tax_regime}
                      onChange={(event) =>
                        updateDeclarationField(
                          'tax_regime',
                          event.target.value,
                        )
                      }
                    >
                      <option value="not_selected">
                        Select tax regime
                      </option>
                      <option value="old">Old Regime</option>
                      <option value="new">New Regime</option>
                    </select>
                  </div>

                  <div className="taxdec-field taxdec-field-full">
                    <label htmlFor="taxdec-add-component">
                      Add declaration component
                    </label>
                    <select
                      id="taxdec-add-component"
                      value=""
                      onChange={(event) =>
                        addDeclarationComponent(event.target.value)
                      }
                    >
                      <option value="">Choose component</option>
                      {DECLARATION_COMPONENTS.map(
                        ([type, label]) => (
                          <option key={type} value={type}>
                            {label}
                          </option>
                        ),
                      )}
                    </select>
                  </div>
                </div>

                {declarationForm.components.length ? (
                  declarationForm.components.map((component, index) => (
                    <article
                      className="taxdec-form-component"
                      key={`${component.type}-${index}`}
                    >
                      <div className="taxdec-form-component-head">
                        <div>
                          <h3>{component.label}</h3>
                          <p>
                            {component.proof_required
                              ? 'Supporting proof required for a positive approved amount.'
                              : 'Supporting proof is not mandatory.'}
                          </p>
                        </div>

                        <button
                          type="button"
                          className="taxdec-btn taxdec-btn-ghost-danger"
                          onClick={() => removeComponent(index)}
                        >
                          <Trash2 size={14} />
                          Remove
                        </button>
                      </div>

                      <div className="taxdec-form-grid">
                        <div className="taxdec-field">
                          <label>Declared amount *</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={component.declared_amount}
                            onChange={(event) =>
                              updateComponent(
                                index,
                                'declared_amount',
                                event.target.value,
                              )
                            }
                          />
                        </div>

                        {canHrReview ? (
                          <div className="taxdec-field">
                            <label>Approved amount</label>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={component.approved_amount}
                              onChange={(event) =>
                                updateComponent(
                                  index,
                                  'approved_amount',
                                  event.target.value,
                                )
                              }
                            />
                          </div>
                        ) : null}

                        <div className="taxdec-field taxdec-field-full">
                          <label>Description</label>
                          <textarea
                            value={component.description}
                            onChange={(event) =>
                              updateComponent(
                                index,
                                'description',
                                event.target.value,
                              )
                            }
                            placeholder="Enter policy, investment, rent, lender or supporting details."
                          />
                        </div>

                        {canHrReview ? (
                          <>
                            <div className="taxdec-field">
                              <label>Proof status</label>
                              <select
                                value={component.proof_status}
                                onChange={(event) =>
                                  updateComponent(
                                    index,
                                    'proof_status',
                                    event.target.value,
                                  )
                                }
                              >
                                {PROOF_STATUS_OPTIONS.map(
                                  ([value, label]) => (
                                    <option key={value} value={value}>
                                      {label}
                                    </option>
                                  ),
                                )}
                              </select>
                            </div>

                            <div className="taxdec-field">
                              <label>Review note</label>
                              <input
                                type="text"
                                value={component.review_note}
                                onChange={(event) =>
                                  updateComponent(
                                    index,
                                    'review_note',
                                    event.target.value,
                                  )
                                }
                              />
                            </div>
                          </>
                        ) : null}
                      </div>

                      <div className="taxdec-proof-list">
                        {(component.proofs || []).map(
                          (proof, proofIndex) => (
                            <div
                              className="taxdec-proof-item"
                              key={`${proof.reference}-${proofIndex}`}
                            >
                              <div>
                                <strong>
                                  {safeText(
                                    proof.filename,
                                    proof.reference,
                                  )}
                                </strong>
                                <small>
                                  {safeText(proof.reference)} ·{' '}
                                  {labelFromKey(proof.status)}
                                </small>
                              </div>

                              <button
                                type="button"
                                className="taxdec-btn taxdec-btn-ghost-danger"
                                onClick={() =>
                                  removeProof(index, proofIndex)
                                }
                              >
                                <Trash2 size={13} />
                                Remove
                              </button>
                            </div>
                          ),
                        )}
                      </div>

                      <button
                        type="button"
                        className="taxdec-btn taxdec-btn-secondary"
                        onClick={() => openProofModal(index)}
                      >
                        <UploadCloud size={14} />
                        Add Proof Reference
                      </button>
                    </article>
                  ))
                ) : (
                  <div className="taxdec-empty" style={{ minHeight: 140 }}>
                    <div>
                      <Plus size={30} />
                      <strong>No declaration components added</strong>
                      <p>
                        Choose the applicable investment, exemption, deduction
                        or income component.
                      </p>
                    </div>
                  </div>
                )}

                <div className="taxdec-field">
                  <label htmlFor="taxdec-employee-note">
                    Employee note
                  </label>
                  <textarea
                    id="taxdec-employee-note"
                    value={declarationForm.employee_note}
                    onChange={(event) =>
                      updateDeclarationField(
                        'employee_note',
                        event.target.value,
                      )
                    }
                    placeholder="Optional overall declaration note."
                  />
                </div>

                <label className="taxdec-checkbox">
                  <input
                    type="checkbox"
                    checked={declarationForm.consent_confirmed}
                    onChange={(event) =>
                      updateDeclarationField(
                        'consent_confirmed',
                        event.target.checked,
                      )
                    }
                  />
                  I confirm that the declaration and proof references are
                  accurate and may be used for payroll review.
                </label>
              </div>

              <div className="taxdec-modal-actions">
                <button
                  type="button"
                  className="taxdec-btn taxdec-btn-secondary"
                  onClick={closeDeclarationForm}
                  disabled={savingDeclaration}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="taxdec-btn taxdec-btn-primary"
                  disabled={savingDeclaration}
                >
                  {savingDeclaration ? (
                    <Loader2 size={16} className="spin" />
                  ) : (
                    <Save size={16} />
                  )}
                  Save Draft
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {showProofModal ? (
        <div className="taxdec-modal-backdrop" role="presentation">
          <div
            className="taxdec-modal is-small"
            role="dialog"
            aria-modal="true"
            aria-labelledby="taxdec-proof-title"
          >
            <div className="taxdec-modal-head">
              <div>
                <h2 id="taxdec-proof-title">Add Proof Reference</h2>
                <p>
                  Store the attachment ID, secure file reference or protected
                  document URL produced by the existing upload system.
                </p>
              </div>

              <button
                type="button"
                className="taxdec-modal-close"
                onClick={closeProofModal}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <form onSubmit={addProof}>
              <div className="taxdec-modal-body">
                <div className="taxdec-form-grid">
                  <div className="taxdec-field taxdec-field-full">
                    <label>File reference *</label>
                    <input
                      type="text"
                      value={proofForm.reference}
                      onChange={(event) =>
                        setProofForm((current) => ({
                          ...current,
                          reference: event.target.value,
                        }))
                      }
                      placeholder="Attachment ID, secure URL or document path"
                      required
                    />
                  </div>

                  <div className="taxdec-field">
                    <label>Filename</label>
                    <input
                      type="text"
                      value={proofForm.filename}
                      onChange={(event) =>
                        setProofForm((current) => ({
                          ...current,
                          filename: event.target.value,
                        }))
                      }
                      placeholder="Example: investment-proof.pdf"
                    />
                  </div>

                  <div className="taxdec-field">
                    <label>Document type</label>
                    <input
                      type="text"
                      value={proofForm.document_type}
                      onChange={(event) =>
                        setProofForm((current) => ({
                          ...current,
                          document_type: normalizeKey(event.target.value),
                        }))
                      }
                    />
                  </div>

                  <div className="taxdec-field taxdec-field-full">
                    <label>Note</label>
                    <textarea
                      value={proofForm.note}
                      onChange={(event) =>
                        setProofForm((current) => ({
                          ...current,
                          note: event.target.value,
                        }))
                      }
                    />
                  </div>
                </div>
              </div>

              <div className="taxdec-modal-actions">
                <button
                  type="button"
                  className="taxdec-btn taxdec-btn-secondary"
                  onClick={closeProofModal}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="taxdec-btn taxdec-btn-primary"
                >
                  <Plus size={15} />
                  Add Proof
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {showReviewModal && reviewDeclaration ? (
        <div className="taxdec-modal-backdrop" role="presentation">
          <div
            className="taxdec-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="taxdec-review-title"
          >
            <div className="taxdec-modal-head">
              <div>
                <h2 id="taxdec-review-title">HR Tax Declaration Review</h2>
                <p>
                  {safeText(reviewDeclaration.employee_name)} · FY{' '}
                  {safeText(reviewDeclaration.financial_year)}
                </p>
              </div>

              <button
                type="button"
                className="taxdec-modal-close"
                onClick={closeReviewModal}
                aria-label="Close"
                disabled={Boolean(actionLoading)}
              >
                ×
              </button>
            </div>

            <form onSubmit={completeHrReview}>
              <div className="taxdec-modal-body">
                {reviewComponents.map((component, index) => (
                  <article
                    className="taxdec-form-component"
                    key={component.component_id || component.type}
                  >
                    <div className="taxdec-form-component-head">
                      <div>
                        <h3>{component.label}</h3>
                        <p>
                          Declared: {formatCurrency(component.declared_amount)}
                        </p>
                      </div>
                    </div>

                    <div className="taxdec-form-grid">
                      <div className="taxdec-field">
                        <label>Approved amount *</label>
                        <input
                          type="number"
                          min="0"
                          max={component.declared_amount}
                          step="0.01"
                          value={component.approved_amount}
                          onChange={(event) =>
                            updateReviewComponent(
                              index,
                              'approved_amount',
                              event.target.value,
                            )
                          }
                        />
                      </div>

                      <div className="taxdec-field">
                        <label>Proof status *</label>
                        <select
                          value={component.proof_status}
                          onChange={(event) =>
                            updateReviewComponent(
                              index,
                              'proof_status',
                              event.target.value,
                            )
                          }
                        >
                          {PROOF_STATUS_OPTIONS.map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="taxdec-field taxdec-field-full">
                        <label>Review note</label>
                        <textarea
                          value={component.review_note}
                          onChange={(event) =>
                            updateReviewComponent(
                              index,
                              'review_note',
                              event.target.value,
                            )
                          }
                        />
                      </div>
                    </div>
                  </article>
                ))}

                <div className="taxdec-field">
                  <label>Overall HR review note</label>
                  <textarea
                    value={reviewNote}
                    onChange={(event) =>
                      setReviewNote(event.target.value)
                    }
                  />
                </div>
              </div>

              <div className="taxdec-modal-actions">
                <button
                  type="button"
                  className="taxdec-btn taxdec-btn-secondary"
                  onClick={closeReviewModal}
                  disabled={Boolean(actionLoading)}
                >
                  Go Back
                </button>
                <button
                  type="submit"
                  className="taxdec-btn taxdec-btn-success"
                  disabled={Boolean(actionLoading)}
                >
                  {actionLoading ? (
                    <Loader2 size={16} className="spin" />
                  ) : (
                    <FileCheck2 size={16} />
                  )}
                  Complete HR Review
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {showReasonModal && reasonRecord ? (
        <div className="taxdec-modal-backdrop" role="presentation">
          <div
            className="taxdec-modal is-small"
            role="dialog"
            aria-modal="true"
            aria-labelledby="taxdec-reason-title"
          >
            <div className="taxdec-modal-head">
              <div>
                <h2 id="taxdec-reason-title">
                  {reasonAction === 'reject'
                    ? 'Reject Tax Declaration'
                    : 'Cancel Tax Declaration'}
                </h2>
                <p>
                  {safeText(reasonRecord.employee_name)} · FY{' '}
                  {safeText(reasonRecord.financial_year)}
                </p>
              </div>

              <button
                type="button"
                className="taxdec-modal-close"
                onClick={closeReasonModal}
                aria-label="Close"
                disabled={Boolean(actionLoading)}
              >
                ×
              </button>
            </div>

            <form onSubmit={submitReasonAction}>
              <div className="taxdec-modal-body">
                <div className="taxdec-field">
                  <label>
                    {reasonAction === 'reject'
                      ? 'Rejection reason *'
                      : 'Cancellation reason *'}
                  </label>
                  <textarea
                    value={reasonText}
                    onChange={(event) =>
                      setReasonText(event.target.value)
                    }
                    required
                  />
                </div>
              </div>

              <div className="taxdec-modal-actions">
                <button
                  type="button"
                  className="taxdec-btn taxdec-btn-secondary"
                  onClick={closeReasonModal}
                  disabled={Boolean(actionLoading)}
                >
                  Go Back
                </button>
                <button
                  type="submit"
                  className="taxdec-btn taxdec-btn-danger"
                  disabled={Boolean(actionLoading)}
                >
                  {actionLoading ? (
                    <Loader2 size={16} className="spin" />
                  ) : reasonAction === 'reject' ? (
                    <ShieldX size={16} />
                  ) : (
                    <Ban size={16} />
                  )}
                  {reasonAction === 'reject'
                    ? 'Reject Declaration'
                    : 'Cancel Declaration'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {showTdsForm && canFinance ? (
        <div className="taxdec-modal-backdrop" role="presentation">
          <div
            className="taxdec-modal is-small"
            role="dialog"
            aria-modal="true"
            aria-labelledby="taxdec-tds-title"
          >
            <div className="taxdec-modal-head">
              <div>
                <h2 id="taxdec-tds-title">New TDS Instruction</h2>
                <p>
                  Create a disabled, manual or external monthly payroll TDS
                  instruction.
                </p>
              </div>

              <button
                type="button"
                className="taxdec-modal-close"
                onClick={closeTdsForm}
                aria-label="Close"
                disabled={savingTds}
              >
                ×
              </button>
            </div>

            <form onSubmit={saveTdsInstruction}>
              <div className="taxdec-modal-body">
                <div className="taxdec-form-grid">
                  <div className="taxdec-field taxdec-field-full">
                    <label>Employee *</label>
                    <select
                      value={tdsForm.employee_id}
                      onChange={(event) =>
                        updateTdsField(
                          'employee_id',
                          event.target.value,
                        )
                      }
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

                  <div className="taxdec-field">
                    <label>Financial year *</label>
                    <select
                      value={tdsForm.financial_year}
                      onChange={(event) =>
                        updateTdsField(
                          'financial_year',
                          event.target.value,
                        )
                      }
                    >
                      {financialYearOptions().map((year) => (
                        <option key={year} value={year}>
                          FY {year}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="taxdec-field">
                    <label>Effective payroll month *</label>
                    <input
                      type="month"
                      value={tdsForm.effective_from_period}
                      onChange={(event) =>
                        updateTdsField(
                          'effective_from_period',
                          event.target.value,
                        )
                      }
                      required
                    />
                  </div>

                  <div className="taxdec-field">
                    <label>TDS mode *</label>
                    <select
                      value={tdsForm.mode}
                      onChange={(event) =>
                        updateTdsField('mode', event.target.value)
                      }
                    >
                      {TDS_MODES.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="taxdec-field">
                    <label>Monthly TDS amount</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={tdsForm.monthly_tds_amount}
                      onChange={(event) =>
                        updateTdsField(
                          'monthly_tds_amount',
                          event.target.value,
                        )
                      }
                      disabled={tdsForm.mode === 'disabled'}
                    />
                  </div>

                  {tdsForm.mode === 'external' ? (
                    <>
                      <div className="taxdec-field">
                        <label>Source system *</label>
                        <input
                          type="text"
                          value={tdsForm.source_system}
                          onChange={(event) =>
                            updateTdsField(
                              'source_system',
                              event.target.value,
                            )
                          }
                          required
                        />
                      </div>

                      <div className="taxdec-field">
                        <label>External reference *</label>
                        <input
                          type="text"
                          value={tdsForm.external_reference}
                          onChange={(event) =>
                            updateTdsField(
                              'external_reference',
                              event.target.value,
                            )
                          }
                          required
                        />
                      </div>
                    </>
                  ) : null}

                  <div className="taxdec-field taxdec-field-full">
                    <label>Instruction note</label>
                    <textarea
                      value={tdsForm.note}
                      onChange={(event) =>
                        updateTdsField('note', event.target.value)
                      }
                    />
                  </div>
                </div>

                <label className="taxdec-checkbox">
                  <input
                    type="checkbox"
                    checked={tdsForm.activate}
                    onChange={(event) =>
                      updateTdsField('activate', event.target.checked)
                    }
                  />
                  Activate immediately and supersede another active instruction
                  for this employee and financial year
                </label>
              </div>

              <div className="taxdec-modal-actions">
                <button
                  type="button"
                  className="taxdec-btn taxdec-btn-secondary"
                  onClick={closeTdsForm}
                  disabled={savingTds}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="taxdec-btn taxdec-btn-primary"
                  disabled={savingTds}
                >
                  {savingTds ? (
                    <Loader2 size={16} className="spin" />
                  ) : (
                    <Save size={16} />
                  )}
                  Save Instruction
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}