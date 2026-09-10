import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BadgeIndianRupee,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileClock,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react';

import { api } from '../api/client';
import { useCustomAlert } from '../components/CustomAlertProvider.jsx';

const DEFAULT_LIMIT = 500;

let componentEditorSequence = 0;

function nextComponentEditorId() {
  componentEditorSequence += 1;
  return `salary-component-editor-${componentEditorSequence}`;
}
const REQUIRED_EARNING_CODES = new Set([
  'basic',
  'hra',
  'medical_allowance',
  'other_allowances',
]);

const SDS_SALARY_COMPONENT_RULES = {
  basic: { percentage: 50, base_component: 'gross_salary' },
  hra: { percentage: 50, base_component: 'basic' },
  medical_allowance: { percentage: 40, base_component: 'basic' },
  other_allowances: { percentage: 10, base_component: 'basic' },
};

const SDS_PF_RULE = {
  employee_rate_percent: 12,
  employer_rate_percent: 12,
  wage_ceiling: 15000,
  wage_base_component_codes: 'basic,hra,medical_allowance',
};

const COMPONENT_CATEGORIES = [
  ['earning', 'Earning'],
  ['employer_contribution', 'Employer Contribution'],
  ['deduction', 'Deduction'],
  ['information', 'Information Only'],
];

const CALCULATION_TYPES = [
  ['fixed', 'Fixed Amount'],
  ['percentage', 'Percentage'],
  ['balancing', 'Balancing Component'],
  ['statutory', 'Statutory Rule'],
];

function safeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function normalizeKey(value) {
  return safeText(value)
    .toLowerCase()
    .replaceAll('-', '_')
    .replaceAll(' ', '_');
}

function normalizeRoles(user = {}) {
  const values = [
    user.role,
    ...(Array.isArray(user.roles)
      ? user.roles
      : typeof user.roles === 'string'
        ? user.roles.split(',')
        : []),
  ];

  return Array.from(new Set(values.map(normalizeKey).filter(Boolean)));
}

function isSuperAdmin(user = {}) {
  return normalizeRoles(user).includes('super_admin');
}

function buildQuery(params = {}) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }

    query.append(key, value);
  });

  const text = query.toString();
  return text ? `?${text}` : '';
}

function dateInputValue(value) {
  if (!value) {
    return '';
  }

  const raw = typeof value === 'object' && value.$date ? value.$date : value;
  const parsed = new Date(raw);

  if (Number.isNaN(parsed.getTime())) {
    return safeText(raw).slice(0, 10);
  }

  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
  const day = String(parsed.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function todayInputValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDate(value) {
  if (!value) {
    return '—';
  }

  const raw = typeof value === 'object' && value.$date ? value.$date : value;
  const parsed = new Date(raw);

  if (Number.isNaN(parsed.getTime())) {
    return safeText(raw, '—');
  }

  return parsed.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function employeeId(employee = {}) {
  return safeText(employee._id || employee.id || employee.employee_id);
}

function employeeName(employee = {}) {
  return safeText(
    employee.employee_name || employee.name || employee.full_name || employee.official_email,
    'Employee',
  );
}

function employeeCode(employee = {}) {
  return safeText(
    employee.employee_code || employee.emp_code || employee.code || employee.employee_id,
    '—',
  );
}

function employeePayrollStateCode(employee = {}) {
  const code = safeText(
    employee.payroll_state_code || employee.work_state_code || employee.state_code,
  ).toUpperCase();

  if (code === 'ALL' || code.length === 2) {
    return code;
  }

  return '';
}

function validStateCode(value) {
  const code = safeText(value).toUpperCase();
  return code === 'ALL' || code.length === 2;
}

function revisionByStatus(history = [], status = '') {
  const normalizedStatus = normalizeKey(status);
  return history.find((item) => normalizeKey(item.status) === normalizedStatus) || null;
}

function statusLabel(value) {
  return safeText(value, 'draft')
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function documentId(document = {}) {
  return safeText(document._id || document.id);
}

function applySdsSalaryComponentRule(component = {}) {
  const code = normalizeKey(component.code);
  const rule = SDS_SALARY_COMPONENT_RULES[code];

  if (!rule) {
    return component;
  }

  return {
    ...component,
    code,
    category: 'earning',
    calculation_type: 'percentage',
    amount: '',
    percentage: rule.percentage,
    base_component: rule.base_component,
    balance_of: 'monthly_ctc',
    minimum_amount: '0',
    statutory_rule: '',
    prorate_on_lwp: true,
    include_in_gross: true,
    include_in_ctc: true,
    show_in_earnings: true,
    show_in_deductions: false,
    is_active: true,
  };
}

function defaultSalaryComponents() {
  return [
    applySdsSalaryComponentRule({
      editor_id: nextComponentEditorId(),
      code: 'basic',
      label: 'Basic',
      taxable: true,
    }),
    applySdsSalaryComponentRule({
      editor_id: nextComponentEditorId(),
      code: 'hra',
      label: 'HRA',
      taxable: true,
    }),
    applySdsSalaryComponentRule({
      editor_id: nextComponentEditorId(),
      code: 'medical_allowance',
      label: 'Medical Allowance',
      taxable: true,
    }),
    applySdsSalaryComponentRule({
      editor_id: nextComponentEditorId(),
      code: 'other_allowances',
      label: 'Other Allowances',
      taxable: true,
    }),
  ];
}

function emptySalaryForm() {
  return {
    id: '',
    status: 'draft',
    employee_id: '',
    employee_code: '',
    employee_name: '',
    structure_name: 'Standard Salary Structure',
    state_code: 'ALL',
    effective_from: todayInputValue(),
    effective_to: '',
    monthly_ctc: '',
    annual_ctc: '',
    currency: 'INR',
    notes: '',
    components: defaultSalaryComponents(),
  };
}

function componentFromDocument(component = {}) {
  return applySdsSalaryComponentRule({
    editor_id: safeText(component.editor_id) || nextComponentEditorId(),
    code: safeText(component.code),
    label: safeText(component.label),
    category: safeText(component.category, 'earning'),
    calculation_type: safeText(component.calculation_type, 'fixed'),
    amount: component.amount ?? '',
    percentage: component.percentage ?? '',
    base_component: safeText(component.base_component, 'monthly_ctc'),
    balance_of: safeText(component.balance_of, 'monthly_ctc'),
    minimum_amount: component.minimum_amount ?? '0',
    statutory_rule: safeText(component.statutory_rule),
    prorate_on_lwp: component.prorate_on_lwp !== false,
    include_in_gross: component.include_in_gross !== false,
    include_in_ctc: component.include_in_ctc !== false,
    show_in_earnings: component.show_in_earnings !== false,
    show_in_deductions: component.show_in_deductions === true,
    taxable: component.taxable !== false,
    is_active: component.is_active !== false,
  });
}

function salaryFormFromDocument(document = {}) {
  return {
    id: documentId(document),
    status: normalizeKey(document.status || 'draft'),
    employee_id: safeText(document.employee_id),
    employee_code: safeText(document.employee_code),
    employee_name: safeText(document.employee_name),
    structure_name: safeText(document.structure_name, 'Standard Salary Structure'),
    state_code: safeText(document.state_code, 'ALL'),
    effective_from: dateInputValue(document.effective_from),
    effective_to: dateInputValue(document.effective_to),
    monthly_ctc: document.monthly_ctc ?? '',
    annual_ctc: document.annual_ctc ?? '',
    currency: safeText(document.currency, 'INR'),
    notes: safeText(document.notes),
    components: Array.isArray(document.components) && document.components.length
      ? document.components.map(componentFromDocument)
      : defaultSalaryComponents(),
  };
}

function emptyStatutoryForm(stateCode = 'ALL') {
  return {
    id: '',
    status: 'draft',
    state_code: safeText(stateCode, 'ALL').toUpperCase(),
    state_name: '',
    effective_from: todayInputValue(),
    effective_to: '',
    rounding_mode: 'nearest_rupee',
    source_reference: '',
    notes: '',
    pf: {
      enabled: false,
      employee_rate_percent: SDS_PF_RULE.employee_rate_percent,
      employer_rate_percent: SDS_PF_RULE.employer_rate_percent,
      wage_ceiling: SDS_PF_RULE.wage_ceiling,
      wage_base_component_codes: SDS_PF_RULE.wage_base_component_codes,
      allow_higher_wage_contribution: false,
      employee_higher_wage_enabled: false,
      employer_higher_wage_enabled: false,
      show_employer_pf_as_earning: true,
      show_employer_pf_as_deduction: true,
    },
    professional_tax: {
      enabled: false,
      basis: 'gross_salary',
      slabs: [],
    },
    esi: {
      enabled: false,
      employee_rate_percent: '',
      employer_rate_percent: '',
      wage_ceiling: '',
      wage_base: 'gross_salary',
    },
    tds: {
      mode: 'disabled',
      source: 'payroll_tax_instruction',
    },
    lwp: {
      divisor_mode: '',
      fixed_days: '',
      prorate_component_codes: 'basic,hra,medical_allowance,other_allowances',
    },
  };
}

function statutoryFormFromDocument(document = {}) {
  const pf = document.pf || {};
  const professionalTax = document.professional_tax || {};
  const esi = document.esi || {};
  const tds = document.tds || {};
  const lwp = document.lwp || {};

  return {
    id: documentId(document),
    status: normalizeKey(document.status || 'draft'),
    state_code: safeText(document.state_code, 'ALL'),
    state_name: safeText(document.state_name),
    effective_from: dateInputValue(document.effective_from),
    effective_to: dateInputValue(document.effective_to),
    rounding_mode: safeText(document.rounding_mode, 'nearest_rupee'),
    source_reference: safeText(document.source_reference),
    notes: safeText(document.notes),
    pf: {
      enabled: pf.enabled === true,
      employee_rate_percent: SDS_PF_RULE.employee_rate_percent,
      employer_rate_percent: SDS_PF_RULE.employer_rate_percent,
      wage_ceiling: SDS_PF_RULE.wage_ceiling,
      wage_base_component_codes: SDS_PF_RULE.wage_base_component_codes,
      allow_higher_wage_contribution: false,
      employee_higher_wage_enabled: false,
      employer_higher_wage_enabled: false,
      show_employer_pf_as_earning: pf.show_employer_pf_as_earning !== false,
      show_employer_pf_as_deduction: pf.show_employer_pf_as_deduction !== false,
    },
    professional_tax: {
      enabled: professionalTax.enabled === true,
      basis: safeText(professionalTax.basis, 'gross_salary'),
      slabs: Array.isArray(professionalTax.slabs)
        ? professionalTax.slabs.map((slab) => ({
            minimum_amount: slab.minimum_amount ?? '',
            maximum_amount: slab.maximum_amount ?? '',
            minimum_inclusive: slab.minimum_inclusive !== false,
            maximum_inclusive: slab.maximum_inclusive !== false,
            tax_amount: slab.tax_amount ?? '',
          }))
        : [],
    },
    esi: {
      enabled: esi.enabled === true,
      employee_rate_percent: esi.employee_rate_percent ?? '',
      employer_rate_percent: esi.employer_rate_percent ?? '',
      wage_ceiling: esi.wage_ceiling ?? '',
      wage_base: safeText(esi.wage_base, 'gross_salary'),
    },
    tds: {
      mode: safeText(tds.mode, 'disabled'),
      source: safeText(tds.source, 'payroll_tax_instruction'),
    },
    lwp: {
      divisor_mode: safeText(lwp.divisor_mode),
      fixed_days: lwp.fixed_days ?? '',
      prorate_component_codes: Array.isArray(lwp.prorate_component_codes)
        ? lwp.prorate_component_codes.join(',')
        : safeText(
            lwp.prorate_component_codes,
            'basic,hra,medical_allowance,other_allowances',
          ),
    },
  };
}

function numberOrBlank(value) {
  if (value === '' || value === null || value === undefined) {
    return '';
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

function listFromCommaText(value) {
  return safeText(value)
    .split(',')
    .map((item) => normalizeKey(item))
    .filter(Boolean);
}

function assamProfessionalTaxSlabs() {
  return [
    {
      minimum_amount: '0',
      maximum_amount: '15000',
      minimum_inclusive: true,
      maximum_inclusive: true,
      tax_amount: '0',
    },
    {
      minimum_amount: '15000',
      maximum_amount: '25000',
      minimum_inclusive: false,
      maximum_inclusive: false,
      tax_amount: '180',
    },
    {
      minimum_amount: '25000',
      maximum_amount: '',
      minimum_inclusive: true,
      maximum_inclusive: true,
      tax_amount: '208',
    },
  ];
}

export default function PayrollConfiguration({ user = {}, setPage = () => {} }) {
  const alerts = useCustomAlert();
  const superAdmin = isSuperAdmin(user);

  const [tab, setTab] = useState('salary');
  const [tenantId, setTenantId] = useState(
    safeText(user.tenant_id || user.tenant?.tenant_id || user.tenant?.code),
  );
  const [employees, setEmployees] = useState([]);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [salaryForm, setSalaryForm] = useState(emptySalaryForm);
  const [salaryHistory, setSalaryHistory] = useState([]);
  const [stateCode, setStateCode] = useState('ALL');
  const [statutoryForm, setStatutoryForm] = useState(() => emptyStatutoryForm('ALL'));
  const [statutoryHistory, setStatutoryHistory] = useState([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [loadingSalary, setLoadingSalary] = useState(false);
  const [loadingStatutory, setLoadingStatutory] = useState(false);
  const [savingSalary, setSavingSalary] = useState(false);
  const [savingStatutory, setSavingStatutory] = useState(false);
  const [deletingSalaryId, setDeletingSalaryId] = useState('');
  const [deletingStatutoryId, setDeletingStatutoryId] = useState('');
  const [expandedComponent, setExpandedComponent] = useState(0);
  const employeeSidebarRef = useRef(null);
  const payrollMainRef = useRef(null);
  const [employeeStatutoryReadiness, setEmployeeStatutoryReadiness] = useState({
    checked: false,
    loading: false,
    state_code: '',
    source_state_code: '',
    active_revision: null,
    error: '',
  });

  const filteredEmployees = useMemo(() => {
    const term = normalizeKey(employeeSearch);

    if (!term) {
      return employees;
    }

    return employees.filter((employee) =>
      [
        employeeName(employee),
        employeeCode(employee),
        employee.department,
        employee.designation,
        employee.official_email,
      ]
        .map(normalizeKey)
        .join(' ')
        .includes(term),
    );
  }, [employeeSearch, employees]);

  const selectedEmployee = useMemo(
    () => employees.find((employee) => employeeId(employee) === selectedEmployeeId) || null,
    [employees, selectedEmployeeId],
  );

  const selectedEmployeeStateCode = useMemo(
    () => employeePayrollStateCode(selectedEmployee || {}),
    [selectedEmployee],
  );

  const activeSalaryRevision = useMemo(
    () => revisionByStatus(salaryHistory, 'active'),
    [salaryHistory],
  );

  const draftSalaryRevision = useMemo(
    () => revisionByStatus(salaryHistory, 'draft'),
    [salaryHistory],
  );

  const salaryValidationIssues = useMemo(() => {
    if (!selectedEmployeeId) {
      return [];
    }

    const issues = [];
    const structureState = safeText(salaryForm.state_code).toUpperCase();
    const monthlyCtc = salaryForm.monthly_ctc;
    const annualCtc = salaryForm.annual_ctc;

    if (!safeText(salaryForm.structure_name)) {
      issues.push({ location: 'Step 2 · Salary details → Structure name', message: 'Enter a structure name.' });
    }

    if (!validStateCode(structureState)) {
      issues.push({ location: 'Step 2 · Salary details → State code', message: 'Use a two-letter payroll state code or ALL.' });
    }

    if (!salaryForm.effective_from) {
      issues.push({ location: 'Step 2 · Salary details → Effective from', message: 'Select the date from which this salary structure applies.' });
    }

    if (salaryForm.effective_to && salaryForm.effective_from && salaryForm.effective_to < salaryForm.effective_from) {
      issues.push({ location: 'Step 2 · Salary details → Effective to', message: 'Effective-to date cannot be earlier than effective-from.' });
    }

    if (monthlyCtc === '' && annualCtc === '') {
      issues.push({ location: 'Step 2 · Salary details → CTC', message: 'Enter monthly CTC or annual CTC.' });
    } else if (monthlyCtc !== '' && annualCtc !== '') {
      const monthlyNumber = Number(monthlyCtc);
      const annualNumber = Number(annualCtc);
      if (Number.isFinite(monthlyNumber) && Number.isFinite(annualNumber) && Math.abs(annualNumber - (monthlyNumber * 12)) > 1) {
        issues.push({ location: 'Step 2 · Salary details → CTC', message: 'Annual CTC must equal monthly CTC × 12.' });
      }
    }

    if (!Array.isArray(salaryForm.components) || salaryForm.components.length === 0) {
      issues.push({ location: 'Step 2 · Salary components', message: 'Add at least one salary component.' });
      return issues;
    }

    const seenCodes = new Set();
    const activeEarningCodes = new Set();
    let activeBalancingCount = 0;

    salaryForm.components.forEach((component, index) => {
      const number = index + 1;
      const code = normalizeKey(component.code);
      const label = safeText(component.label);
      const calculationType = normalizeKey(component.calculation_type);

      if (!code) {
        issues.push({ location: `Step 2 · Salary components → Component ${number} code`, message: 'Component code is required.' });
      } else if (seenCodes.has(code)) {
        issues.push({ location: `Step 2 · Salary components → ${code}`, message: 'Component codes must be unique.' });
      } else {
        seenCodes.add(code);
      }

      if (!label) {
        issues.push({ location: `Step 2 · Salary components → Component ${number} label`, message: 'Display label is required.' });
      }

      if (component.is_active && normalizeKey(component.category) === 'earning' && code) {
        activeEarningCodes.add(code);
      }

      if (component.is_active && calculationType === 'balancing') {
        activeBalancingCount += 1;
      }

      if (calculationType === 'fixed' && component.amount === '') {
        issues.push({ location: `Step 2 · Salary components → ${label || code || `Component ${number}`}`, message: 'Fixed components require a monthly amount.' });
      }

      if (calculationType === 'percentage') {
        if (component.percentage === '') {
          issues.push({ location: `Step 2 · Salary components → ${label || code || `Component ${number}`}`, message: 'Percentage components require a percentage value.' });
        }
        if (code && normalizeKey(component.base_component) === code) {
          issues.push({ location: `Step 2 · Salary components → ${label || code}`, message: 'A percentage component cannot use itself as its calculation base.' });
        }
      }

      if (calculationType === 'statutory' && !normalizeKey(component.statutory_rule)) {
        issues.push({ location: `Step 2 · Salary components → ${label || code || `Component ${number}`}`, message: 'Statutory components require a statutory rule code.' });
      }
    });

    const missingRequired = Array.from(REQUIRED_EARNING_CODES).filter(
      (code) => !activeEarningCodes.has(code),
    );
    if (missingRequired.length) {
      issues.push({
        location: 'Step 2 · Salary components → Required earnings',
        message: `Missing active earning component(s): ${missingRequired.join(', ')}.`,
      });
    }

    if (activeBalancingCount > 1) {
      issues.push({ location: 'Step 2 · Salary components → Balancing component', message: 'Only one active balancing component is allowed.' });
    }

    return issues;
  }, [salaryForm, selectedEmployeeId]);

  const statutoryValidationIssues = useMemo(() => {
    const issues = [];
    const code = safeText(statutoryForm.state_code).toUpperCase();

    if (!validStateCode(code)) {
      issues.push({ location: 'Step 4 · Statutory rules → State code', message: 'Use a two-letter state code or ALL.' });
    }

    if (!statutoryForm.effective_from) {
      issues.push({ location: 'Step 4 · Statutory rules → Effective from', message: 'Select the effective-from date.' });
    }

    if (statutoryForm.effective_to && statutoryForm.effective_from && statutoryForm.effective_to < statutoryForm.effective_from) {
      issues.push({ location: 'Step 4 · Statutory rules → Effective to', message: 'Effective-to date cannot be earlier than effective-from.' });
    }

    if (statutoryForm.esi.enabled) {
      [['employee_rate_percent', 'Employee ESI rate'], ['employer_rate_percent', 'Employer ESI rate'], ['wage_ceiling', 'ESI wage ceiling']].forEach(([field, label]) => {
        if (statutoryForm.esi[field] === '') {
          issues.push({ location: `Step 4 · Statutory rules → ESI → ${label}`, message: `${label} is required while ESI is enabled.` });
        }
      });
    }

    if (statutoryForm.professional_tax.enabled) {
      const slabs = statutoryForm.professional_tax.slabs || [];
      if (!slabs.length) {
        issues.push({ location: 'Step 4 · Statutory rules → Professional Tax → Slabs', message: 'Add at least one Professional Tax slab.' });
      }
      slabs.forEach((slab, index) => {
        const label = `Slab ${index + 1}`;
        if (slab.minimum_amount === '') {
          issues.push({ location: `Step 4 · Statutory rules → Professional Tax → ${label}`, message: 'Minimum amount is required.' });
        }
        if (slab.tax_amount === '') {
          issues.push({ location: `Step 4 · Statutory rules → Professional Tax → ${label}`, message: 'Tax amount is required.' });
        }
        if (slab.maximum_amount === '' && index !== slabs.length - 1) {
          issues.push({ location: `Step 4 · Statutory rules → Professional Tax → ${label}`, message: 'Only the final Professional Tax slab may be open-ended.' });
        }
        if (slab.maximum_amount !== '' && Number(slab.maximum_amount) < Number(slab.minimum_amount || 0)) {
          issues.push({ location: `Step 4 · Statutory rules → Professional Tax → ${label}`, message: 'Maximum amount cannot be below the minimum amount.' });
        }
      });
    }

    if (!safeText(statutoryForm.lwp.divisor_mode)) {
      issues.push({ location: 'Step 4 · Statutory rules → LWP → Divisor mode', message: 'Choose Calendar Days, Working Days, or Fixed Days before payroll calculation.' });
    }

    if (statutoryForm.lwp.divisor_mode === 'fixed_days' && statutoryForm.lwp.fixed_days === '') {
      issues.push({ location: 'Step 4 · Statutory rules → LWP → Fixed days', message: 'Enter the fixed divisor days.' });
    }

    return issues;
  }, [statutoryForm]);

  function tenantParams() {
    return superAdmin && tenantId.trim() ? { tenant_id: tenantId.trim() } : {};
  }

  async function loadEmployees({ silent = false } = {}) {
    if (superAdmin && !tenantId.trim()) {
      setEmployees([]);
      setSelectedEmployeeId('');

      if (!silent) {
        alerts.warning('Enter the company tenant ID first.', 'Tenant Required');
      }
      return;
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
      const items = [...(data.items || [])].sort((first, second) =>
        employeeName(first).localeCompare(employeeName(second)),
      );

      setEmployees(items);
      setSelectedEmployeeId((current) =>
        items.some((employee) => employeeId(employee) === current) ? current : '',
      );
    } catch (error) {
      setEmployees([]);
      setSelectedEmployeeId('');

      if (!silent) {
        alerts.error(error.message || 'Unable to load employees.', 'Employee Load Failed');
      }
    } finally {
      setLoadingEmployees(false);
    }
  }

  async function loadSalaryHistory(employeeReference = selectedEmployeeId) {
    if (!employeeReference) {
      setSalaryHistory([]);
      setSalaryForm(emptySalaryForm());
      return;
    }

    try {
      setLoadingSalary(true);
      const data = await api(
        `/payroll/salary-structure/${encodeURIComponent(employeeReference)}/history${buildQuery(
          tenantParams(),
        )}`,
      );
      const history = data.history || [];
      const editableDraft = history.find((item) => normalizeKey(item.status) === 'draft');
      const latest = editableDraft || history[0];
      const employee = employees.find((item) => employeeId(item) === employeeReference);

      setSalaryHistory(history);

      if (latest) {
        setSalaryForm(salaryFormFromDocument(latest));
      } else {
        setSalaryForm({
          ...emptySalaryForm(),
          employee_id: employeeReference,
          employee_code: employeeCode(employee),
          employee_name: employeeName(employee),
          state_code: employeePayrollStateCode(employee) || 'ALL',
        });
      }
    } catch (error) {
      setSalaryHistory([]);
      alerts.error(
        error.message || 'Unable to load salary structure history.',
        'Salary Structure Load Failed',
      );
    } finally {
      setLoadingSalary(false);
    }
  }

  async function loadStatutoryHistory(code = stateCode) {
    const normalizedCode = safeText(code, 'ALL').toUpperCase();

    if (normalizedCode !== 'ALL' && normalizedCode.length !== 2) {
      alerts.warning('Use a two-letter state code or ALL.', 'Invalid State Code');
      return;
    }

    if (superAdmin && !tenantId.trim()) {
      alerts.warning('Enter the company tenant ID first.', 'Tenant Required');
      return;
    }

    try {
      setLoadingStatutory(true);
      const data = await api(
        `/payroll/statutory-config/${encodeURIComponent(normalizedCode)}/history${buildQuery(
          tenantParams(),
        )}`,
      );
      const history = data.history || [];
      const editableDraft = history.find((item) => normalizeKey(item.status) === 'draft');
      const latest = editableDraft || history[0];

      setStateCode(normalizedCode);
      setStatutoryHistory(history);
      setStatutoryForm(
        latest ? statutoryFormFromDocument(latest) : emptyStatutoryForm(normalizedCode),
      );
    } catch (error) {
      setStatutoryHistory([]);
      alerts.error(
        error.message || 'Unable to load statutory configuration history.',
        'Statutory Configuration Load Failed',
      );
    } finally {
      setLoadingStatutory(false);
    }
  }

  async function loadEmployeeStatutoryReadiness(employee = selectedEmployee) {
    const payrollState = employeePayrollStateCode(employee || {});

    if (!employee || !employeeId(employee)) {
      setEmployeeStatutoryReadiness({
        checked: false,
        loading: false,
        state_code: '',
        source_state_code: '',
        active_revision: null,
        error: '',
      });
      return;
    }

    if (!payrollState) {
      setEmployeeStatutoryReadiness({
        checked: true,
        loading: false,
        state_code: '',
        source_state_code: '',
        active_revision: null,
        error: 'Employee payroll state is missing or is not a two-letter state code.',
      });
      return;
    }

    setEmployeeStatutoryReadiness((current) => ({
      ...current,
      checked: false,
      loading: true,
      state_code: payrollState,
      source_state_code: '',
      active_revision: null,
      error: '',
    }));

    try {
      const loadHistory = async (code) => {
        const data = await api(
          `/payroll/statutory-config/${encodeURIComponent(code)}/history${buildQuery(tenantParams())}`,
        );
        return data.history || [];
      };

      const stateHistory = await loadHistory(payrollState);
      let activeRevision = revisionByStatus(stateHistory, 'active');
      let sourceStateCode = activeRevision ? payrollState : '';

      if (!activeRevision && payrollState !== 'ALL') {
        const fallbackHistory = await loadHistory('ALL');
        activeRevision = revisionByStatus(fallbackHistory, 'active');
        sourceStateCode = activeRevision ? 'ALL' : '';
      }

      setEmployeeStatutoryReadiness({
        checked: true,
        loading: false,
        state_code: payrollState,
        source_state_code: sourceStateCode,
        active_revision: activeRevision,
        error: '',
      });
    } catch (error) {
      setEmployeeStatutoryReadiness({
        checked: true,
        loading: false,
        state_code: payrollState,
        source_state_code: '',
        active_revision: null,
        error: error.message || 'Unable to verify statutory configuration.',
      });
    }
  }

  useEffect(() => {
    if (!superAdmin || tenantId.trim()) {
      loadEmployees({ silent: true });
    }
    // Initial tenant load only. Superadmin can use the explicit load button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

 // Presentation-only sticky employee sidebar.
// Important: ignore scroll events originating inside the sidebar itself.
// Reposition only when the actual page/app scroll container moves.
useEffect(() => {
  if (tab !== 'salary') return undefined;

  const sidebar = employeeSidebarRef.current;
  if (!sidebar) return undefined;

  const layout = sidebar.closest('.payroll-config-layout');
  if (!layout) return undefined;

  let frame = 0;

  const resetSidebar = () => {
    sidebar.classList.remove('is-sticky-fixed', 'is-sticky-bottom');
    sidebar.style.removeProperty('--payroll-sidebar-left');
    sidebar.style.removeProperty('--payroll-sidebar-width');
    sidebar.style.removeProperty('--payroll-sidebar-height');
  };

  const updateSidebarPosition = () => {
    frame = 0;

    // Mobile/tablet layout must remain normal-flow.
    if (
      window.matchMedia('(max-width: 1050px)').matches
      || window.matchMedia('(pointer: coarse)').matches
    ) {
      resetSidebar();
      return;
    }

    const topOffset = 18;
    const layoutRect = layout.getBoundingClientRect();

    // IMPORTANT:
    // Do not repeatedly remove/re-add fixed positioning just to measure it.
    // That behaviour was interrupting scrolling on some browsers/devices.
    const sidebarWidth =
      sidebar.offsetWidth
      || Number.parseFloat(
        getComputedStyle(sidebar).getPropertyValue('--payroll-sidebar-width'),
      )
      || 0;

    const sidebarHeight = sidebar.offsetHeight;

    sidebar.style.setProperty(
      '--payroll-sidebar-left',
      `${layoutRect.left}px`,
    );

    if (sidebarWidth) {
      sidebar.style.setProperty(
        '--payroll-sidebar-width',
        `${sidebarWidth}px`,
      );
    }

    if (sidebarHeight) {
      sidebar.style.setProperty(
        '--payroll-sidebar-height',
        `${sidebarHeight}px`,
      );
    }

    if (layoutRect.top > topOffset) {
      sidebar.classList.remove('is-sticky-fixed', 'is-sticky-bottom');
      return;
    }

    if (layoutRect.bottom <= sidebarHeight + topOffset) {
      sidebar.classList.remove('is-sticky-fixed');
      sidebar.classList.add('is-sticky-bottom');
      return;
    }

    sidebar.classList.remove('is-sticky-bottom');
    sidebar.classList.add('is-sticky-fixed');
  };

  const scheduleUpdate = (event) => {
    // Critical fix:
    // scrolling the employee list must NOT trigger sidebar repositioning.
    if (
      event?.target instanceof Node
      && sidebar.contains(event.target)
    ) {
      return;
    }

    if (frame) {
      cancelAnimationFrame(frame);
    }

    frame = requestAnimationFrame(updateSidebarPosition);
  };

  scheduleUpdate();

  window.addEventListener('scroll', scheduleUpdate, { passive: true });
  window.addEventListener('resize', scheduleUpdate, { passive: true });

  // Keep support for app-shell scroll containers,
  // but do not process scrolling occurring inside the sidebar.
  document.addEventListener('scroll', scheduleUpdate, {
    capture: true,
    passive: true,
  });

  return () => {
    if (frame) {
      cancelAnimationFrame(frame);
    }

    window.removeEventListener('scroll', scheduleUpdate);
    window.removeEventListener('resize', scheduleUpdate);
    document.removeEventListener('scroll', scheduleUpdate, true);

    resetSidebar();
  };
}, [tab, filteredEmployees.length]);

  useEffect(() => {
    if (selectedEmployeeId) {
      loadSalaryHistory(selectedEmployeeId);
      loadEmployeeStatutoryReadiness(selectedEmployee);
    } else {
      setSalaryHistory([]);
      setSalaryForm(emptySalaryForm());
      setEmployeeStatutoryReadiness({
        checked: false,
        loading: false,
        state_code: '',
        source_state_code: '',
        active_revision: null,
        error: '',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmployeeId, selectedEmployee]);

  function selectEmployee(employeeReference) {
    if (!employeeReference || employeeReference === selectedEmployeeId) {
      return;
    }

    setSelectedEmployeeId(employeeReference);

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        payrollMainRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
          inline: 'nearest',
        });
      });
    });
  }

  function updateSalaryField(field, value) {
    setSalaryForm((current) => {
      const next = { ...current, [field]: value };

      if (field === 'monthly_ctc') {
        const number = Number(value);
        next.annual_ctc = Number.isFinite(number) && value !== ''
          ? Math.round(number * 12 * 100) / 100
          : '';
      }

      if (field === 'annual_ctc') {
        const number = Number(value);
        next.monthly_ctc = Number.isFinite(number) && value !== ''
          ? Math.round((number / 12) * 100) / 100
          : '';
      }

      return next;
    });
  }

  function updateComponent(index, field, value) {
    setSalaryForm((current) => ({
      ...current,
      components: current.components.map((component, componentIndex) => {
        if (componentIndex !== index) {
          return component;
        }

        const code = normalizeKey(component.code);
        const protectedFields = new Set([
          'code',
          'category',
          'calculation_type',
          'amount',
          'percentage',
          'base_component',
          'balance_of',
          'minimum_amount',
          'statutory_rule',
          'prorate_on_lwp',
          'include_in_gross',
          'include_in_ctc',
          'show_in_earnings',
          'show_in_deductions',
          'is_active',
        ]);

        if (REQUIRED_EARNING_CODES.has(code) && protectedFields.has(field)) {
          return applySdsSalaryComponentRule(component);
        }

        return { ...component, [field]: value };
      }),
    }));
  }

  function addComponent() {
    setSalaryForm((current) => {
      const newIndex = current.components.length;

      setExpandedComponent(newIndex);

      return {
        ...current,
        components: [
          ...current.components,
          {
            editor_id: nextComponentEditorId(),
            code: '',
            label: '',
            category: 'earning',
            calculation_type: 'fixed',
            amount: '',
            percentage: '',
            base_component: 'monthly_ctc',
            balance_of: 'monthly_ctc',
            minimum_amount: '0',
            statutory_rule: '',
            prorate_on_lwp: true,
            include_in_gross: true,
            include_in_ctc: true,
            show_in_earnings: true,
            show_in_deductions: false,
            taxable: true,
            is_active: true,
          },
        ],
      };
    });
  }

  function removeComponent(index) {
    const component = salaryForm.components[index];

    if (REQUIRED_EARNING_CODES.has(normalizeKey(component?.code))) {
      alerts.warning(
        `${component.label || component.code} is required by the approved payslip format.`,
        'Required Component',
      );
      return;
    }

    setSalaryForm((current) => ({
      ...current,
      components: current.components.filter((_, componentIndex) => componentIndex !== index),
    }));
    setExpandedComponent(-1);
  }

  function salaryPayload() {
    const employee = selectedEmployee;

    return {
      ...(salaryForm.id && normalizeKey(salaryForm.status) === 'draft'
        ? { _id: salaryForm.id }
        : {}),
      ...tenantParams(),
      employee_id: selectedEmployeeId,
      employee_code: employeeCode(employee),
      employee_name: employeeName(employee),
      structure_name: salaryForm.structure_name,
      state_code: salaryForm.state_code,
      effective_from: salaryForm.effective_from,
      effective_to: salaryForm.effective_to || null,
      monthly_ctc: numberOrBlank(salaryForm.monthly_ctc),
      annual_ctc: numberOrBlank(salaryForm.annual_ctc),
      currency: salaryForm.currency,
      notes: salaryForm.notes,
      components: salaryForm.components.map((component, index) => {
        const normalized = applySdsSalaryComponentRule(component);

        return {
          code: normalizeKey(normalized.code),
          label: normalized.label,
          category: normalized.category,
          calculation_type: normalized.calculation_type,
          amount: numberOrBlank(normalized.amount),
          percentage: numberOrBlank(normalized.percentage),
          base_component: normalizeKey(normalized.base_component),
          balance_of: normalizeKey(normalized.balance_of),
          minimum_amount: numberOrBlank(normalized.minimum_amount || 0),
          statutory_rule: normalizeKey(normalized.statutory_rule),
          prorate_on_lwp: normalized.prorate_on_lwp,
          include_in_gross: normalized.include_in_gross,
          include_in_ctc: normalized.include_in_ctc,
          show_in_earnings: normalized.show_in_earnings,
          show_in_deductions: normalized.show_in_deductions,
          taxable: normalized.taxable,
          is_active: normalized.is_active,
          display_order: index + 1,
        };
      }),
    };
  }

  async function saveSalaryDraft() {
    if (!selectedEmployeeId) {
      alerts.warning('Select an employee first.', 'Employee Required');
      return;
    }

    try {
      setSavingSalary(true);
      const data = await api('/payroll/salary-structure', {
        method: 'POST',
        body: JSON.stringify(salaryPayload()),
      });

      setSalaryForm(salaryFormFromDocument(data.salary_structure || {}));
      await loadSalaryHistory(selectedEmployeeId);
      alerts.success('Salary structure draft saved successfully.', 'Draft Saved');
    } catch (error) {
      alerts.error(error.message || 'Unable to save salary structure.', 'Save Failed');
    } finally {
      setSavingSalary(false);
    }
  }

  async function activateSalaryDraft(document = salaryForm) {
    const id = documentId(document) || document.id;

    if (!id || normalizeKey(document.status) !== 'draft') {
      alerts.warning('Save or select a salary structure draft first.', 'Draft Required');
      return;
    }

    const confirmed = await alerts.confirm(
      'Activate this salary revision? The current active revision will be superseded from the new effective date.',
      {
        title: 'Activate Salary Revision',
        confirmText: 'Activate Revision',
      },
    );

    if (!confirmed) {
      return;
    }

    try {
      setSavingSalary(true);
      await api(`/payroll/salary-structure/${encodeURIComponent(id)}/activate`, {
        method: 'POST',
        body: JSON.stringify(tenantParams()),
      });
      await loadSalaryHistory(selectedEmployeeId);
      alerts.success('Salary structure revision activated.', 'Revision Activated');
    } catch (error) {
      alerts.error(error.message || 'Unable to activate salary revision.', 'Activation Failed');
    } finally {
      setSavingSalary(false);
    }
  }

  async function deleteActiveSalaryRevision(document = {}) {
    const id = documentId(document);

    if (!id || normalizeKey(document.status) !== 'active') {
      alerts.warning('Only the currently active salary revision can be deleted with this action.', 'Active Revision Required');
      return;
    }

    const confirmed = await alerts.confirm(
      `Delete ACTIVE salary revision Version ${document.version || '—'} effective from ${formatDate(document.effective_from)}? This should only be used to correct an accidentally activated salary structure, such as an incorrect state code. The action cannot be undone from this screen.`,
      {
        title: 'Delete Active Salary Revision',
        confirmText: 'Delete Active Revision',
      },
    );

    if (!confirmed) {
      return;
    }

    try {
      setDeletingSalaryId(id);
      const data = await api(`/payroll/salary-structure/${encodeURIComponent(id)}/active`, {
        method: 'DELETE',
        body: JSON.stringify(tenantParams()),
      });
      await loadSalaryHistory(selectedEmployeeId);
      alerts.success(
        data.message || 'Active salary revision deleted. You can now create or activate the corrected salary revision.',
        'Active Revision Deleted',
      );
    } catch (error) {
      alerts.error(
        error.message || 'Unable to delete the active salary revision.',
        'Delete Active Revision Failed',
      );
    } finally {
      setDeletingSalaryId('');
    }
  }

  async function deleteSalaryDraft(document = {}) {
    const id = documentId(document);

    if (!id || normalizeKey(document.status) !== 'draft') {
      alerts.warning('Only salary structure drafts can be deleted.', 'Draft Required');
      return;
    }

    const confirmed = await alerts.confirm(
      `Delete salary structure draft Version ${document.version || '—'}? This cannot be undone.`,
      {
        title: 'Delete Salary Draft',
        confirmText: 'Delete Draft',
      },
    );

    if (!confirmed) {
      return;
    }

    try {
      setDeletingSalaryId(id);
      await api(`/payroll/salary-structure/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        body: JSON.stringify(tenantParams()),
      });
      await loadSalaryHistory(selectedEmployeeId);
      alerts.success('Salary structure draft deleted.', 'Draft Deleted');
    } catch (error) {
      alerts.error(error.message || 'Unable to delete salary structure draft.', 'Delete Failed');
    } finally {
      setDeletingSalaryId('');
    }
  }

  function startSalaryRevision(source = salaryForm) {
    const sourceDocument = source.components ? source : salaryFormFromDocument(source);

    setSalaryForm({
      ...sourceDocument,
      id: '',
      status: 'draft',
      effective_from: todayInputValue(),
      effective_to: '',
      notes: '',
    });
    setExpandedComponent(0);
  }

  function updateStatutorySection(section, field, value) {
    const protectedPfFields = new Set([
      'employee_rate_percent',
      'employer_rate_percent',
      'wage_ceiling',
      'wage_base_component_codes',
      'allow_higher_wage_contribution',
      'employee_higher_wage_enabled',
      'employer_higher_wage_enabled',
    ]);

    setStatutoryForm((current) => ({
      ...current,
      [section]: {
        ...current[section],
        ...(section === 'pf' && protectedPfFields.has(field) ? {} : { [field]: value }),
        ...(section === 'pf'
          ? {
              employee_rate_percent: SDS_PF_RULE.employee_rate_percent,
              employer_rate_percent: SDS_PF_RULE.employer_rate_percent,
              wage_ceiling: SDS_PF_RULE.wage_ceiling,
              wage_base_component_codes: SDS_PF_RULE.wage_base_component_codes,
              allow_higher_wage_contribution: false,
              employee_higher_wage_enabled: false,
              employer_higher_wage_enabled: false,
            }
          : {}),
      },
    }));
  }

  function addPtSlab() {
    setStatutoryForm((current) => ({
      ...current,
      professional_tax: {
        ...current.professional_tax,
        slabs: [
          ...current.professional_tax.slabs,
          {
            minimum_amount: '',
            maximum_amount: '',
            minimum_inclusive: true,
            maximum_inclusive: true,
            tax_amount: '',
          },
        ],
      },
    }));
  }

  function updatePtSlab(index, field, value) {
    setStatutoryForm((current) => ({
      ...current,
      professional_tax: {
        ...current.professional_tax,
        slabs: current.professional_tax.slabs.map((slab, slabIndex) =>
          slabIndex === index ? { ...slab, [field]: value } : slab,
        ),
      },
    }));
  }

  function removePtSlab(index) {
    setStatutoryForm((current) => ({
      ...current,
      professional_tax: {
        ...current.professional_tax,
        slabs: current.professional_tax.slabs.filter(
          (_, slabIndex) => slabIndex !== index,
        ),
      },
    }));
  }

  function applyAssamProfessionalTaxPreset() {
    setStateCode('AS');
    setStatutoryForm((current) => ({
      ...current,
      state_code: 'AS',
      state_name: current.state_name || 'Assam',
      // Preserve the date already selected by the user. Use the preset
      // commencement date only when the field is currently empty.
      effective_from: safeText(current.effective_from, '2025-04-01'),
      source_reference:
        current.source_reference ||
        'Assam Professional Tax rates effective April 2025',
      professional_tax: {
        ...current.professional_tax,
        enabled: true,
        basis: 'gross_salary',
        slabs: assamProfessionalTaxSlabs(),
      },
    }));

    alerts.success(
      'Assam Professional Tax slabs were loaded into the current draft without changing your selected effective date. Review and save the draft before activation.',
      'Assam PT Preset Loaded',
    );
  }

  function openTaxDeclarations() {
    setPage('tax_declarations');
  }

  function statutoryPayload() {
    return {
      ...(statutoryForm.id && normalizeKey(statutoryForm.status) === 'draft'
        ? { _id: statutoryForm.id }
        : {}),
      ...tenantParams(),
      state_code: safeText(statutoryForm.state_code, 'ALL').toUpperCase(),
      state_name: statutoryForm.state_name,
      effective_from: statutoryForm.effective_from,
      effective_to: statutoryForm.effective_to || null,
      rounding_mode: statutoryForm.rounding_mode,
      source_reference: statutoryForm.source_reference,
      notes: statutoryForm.notes,
      pf: {
        ...statutoryForm.pf,
        employee_rate_percent: SDS_PF_RULE.employee_rate_percent,
        employer_rate_percent: SDS_PF_RULE.employer_rate_percent,
        wage_ceiling: SDS_PF_RULE.wage_ceiling,
        wage_base_component_codes: listFromCommaText(
          SDS_PF_RULE.wage_base_component_codes,
        ),
        allow_higher_wage_contribution: false,
        employee_higher_wage_enabled: false,
        employer_higher_wage_enabled: false,
      },
      professional_tax: {
        enabled: statutoryForm.professional_tax.enabled,
        basis: 'gross_salary',
        slabs: statutoryForm.professional_tax.slabs.map((slab) => ({
          minimum_amount: numberOrBlank(slab.minimum_amount),
          maximum_amount: slab.maximum_amount === ''
            ? null
            : numberOrBlank(slab.maximum_amount),
          minimum_inclusive: slab.minimum_inclusive,
          maximum_inclusive: slab.maximum_inclusive,
          tax_amount: numberOrBlank(slab.tax_amount),
        })),
      },
      esi: {
        ...statutoryForm.esi,
        employee_rate_percent: numberOrBlank(statutoryForm.esi.employee_rate_percent),
        employer_rate_percent: numberOrBlank(statutoryForm.esi.employer_rate_percent),
        wage_ceiling: numberOrBlank(statutoryForm.esi.wage_ceiling),
        wage_base: normalizeKey(statutoryForm.esi.wage_base),
      },
      tds: {
        mode: normalizeKey(statutoryForm.tds.mode || 'disabled'),
        source: safeText(
          statutoryForm.tds.source,
          'payroll_tax_instruction',
        ),
      },
      lwp: {
        divisor_mode: statutoryForm.lwp.divisor_mode,
        fixed_days: statutoryForm.lwp.divisor_mode === 'fixed_days'
          ? numberOrBlank(statutoryForm.lwp.fixed_days)
          : null,
        prorate_component_codes: listFromCommaText(
          statutoryForm.lwp.prorate_component_codes,
        ),
      },
    };
  }

  async function saveStatutoryDraft() {
    const normalizedCode = safeText(statutoryForm.state_code, 'ALL').toUpperCase();

    if (normalizedCode !== 'ALL' && normalizedCode.length !== 2) {
      alerts.warning('Use a two-letter state code or ALL.', 'Invalid State Code');
      return;
    }

    try {
      setSavingStatutory(true);
      const data = await api('/payroll/statutory-config', {
        method: 'POST',
        body: JSON.stringify(statutoryPayload()),
      });
      const saved = data.statutory_config || {};

      setStateCode(safeText(saved.state_code, normalizedCode));
      setStatutoryForm(statutoryFormFromDocument(saved));
      await loadStatutoryHistory(safeText(saved.state_code, normalizedCode));
      alerts.success('Statutory configuration draft saved.', 'Draft Saved');
    } catch (error) {
      alerts.error(error.message || 'Unable to save statutory configuration.', 'Save Failed');
    } finally {
      setSavingStatutory(false);
    }
  }

  async function activateStatutoryDraft(document = statutoryForm) {
    const id = documentId(document) || document.id;

    if (!id || normalizeKey(document.status) !== 'draft') {
      alerts.warning('Save or select a statutory configuration draft first.', 'Draft Required');
      return;
    }

    const confirmed = await alerts.confirm(
      'Activate this statutory revision? The current active revision for the same state will be superseded.',
      {
        title: 'Activate Statutory Revision',
        confirmText: 'Activate Revision',
      },
    );

    if (!confirmed) {
      return;
    }

    try {
      setSavingStatutory(true);
      await api(`/payroll/statutory-config/${encodeURIComponent(id)}/activate`, {
        method: 'POST',
        body: JSON.stringify(tenantParams()),
      });
      await loadStatutoryHistory(statutoryForm.state_code);
      await loadEmployeeStatutoryReadiness(selectedEmployee);
      alerts.success('Statutory revision activated.', 'Revision Activated');
    } catch (error) {
      alerts.error(error.message || 'Unable to activate statutory revision.', 'Activation Failed');
    } finally {
      setSavingStatutory(false);
    }
  }

  async function deleteActiveStatutoryRevision(document = {}) {
    const id = documentId(document);

    if (!id || normalizeKey(document.status) !== 'active') {
      alerts.warning('Only the currently active statutory revision can be deleted with this action.', 'Active Revision Required');
      return;
    }

    const confirmed = await alerts.confirm(
      `Delete ACTIVE statutory revision ${safeText(document.state_code, 'ALL')} Version ${document.version || '—'} effective from ${formatDate(document.effective_from)}? This should only be used to correct an accidentally activated revision. The action cannot be undone from this screen.`,
      {
        title: 'Delete Active Statutory Revision',
        confirmText: 'Delete Active Revision',
      },
    );

    if (!confirmed) {
      return;
    }

    try {
      setDeletingStatutoryId(id);
      const data = await api(`/payroll/statutory-config/${encodeURIComponent(id)}/active`, {
        method: 'DELETE',
        body: JSON.stringify(tenantParams()),
      });
      await loadStatutoryHistory(safeText(document.state_code, stateCode));
      await loadEmployeeStatutoryReadiness(selectedEmployee);
      alerts.success(
        data.message || 'Active statutory revision deleted. You can now activate the corrected draft.',
        'Active Revision Deleted',
      );
    } catch (error) {
      alerts.error(
        error.message || 'Unable to delete the active statutory revision.',
        'Delete Active Revision Failed',
      );
    } finally {
      setDeletingStatutoryId('');
    }
  }

  async function deleteSupersededStatutoryRevision(document = {}) {
    const id = documentId(document);

    if (!id || normalizeKey(document.status) !== 'superseded') {
      alerts.warning('Only superseded statutory revisions can be deleted with this action.', 'Superseded Revision Required');
      return;
    }

    const confirmed = await alerts.confirm(
      `Delete superseded statutory revision ${safeText(document.state_code, 'ALL')} Version ${document.version || '—'}? This revision will remain reserved in audit history and cannot be reused. Deletion is blocked if payroll records already depend on it.`,
      {
        title: 'Delete Superseded Statutory Revision',
        confirmText: 'Delete Superseded',
      },
    );

    if (!confirmed) {
      return;
    }

    try {
      setDeletingStatutoryId(id);
      const data = await api(`/payroll/statutory-config/${encodeURIComponent(id)}/superseded`, {
        method: 'DELETE',
        body: JSON.stringify(tenantParams()),
      });
      await loadStatutoryHistory(safeText(document.state_code, stateCode));
      await loadEmployeeStatutoryReadiness(selectedEmployee);
      alerts.success(
        data.message || 'Superseded statutory revision deleted successfully.',
        'Superseded Revision Deleted',
      );
    } catch (error) {
      alerts.error(
        error.message || 'Unable to delete the superseded statutory revision.',
        'Delete Superseded Revision Failed',
      );
    } finally {
      setDeletingStatutoryId('');
    }
  }

  async function deleteStatutoryDraft(document = {}) {
    const id = documentId(document);

    if (!id || normalizeKey(document.status) !== 'draft') {
      alerts.warning('Only statutory configuration drafts can be deleted.', 'Draft Required');
      return;
    }

    const confirmed = await alerts.confirm(
      `Delete statutory draft ${safeText(document.state_code, 'ALL')} Version ${document.version || '—'}? This cannot be undone.`,
      {
        title: 'Delete Statutory Draft',
        confirmText: 'Delete Draft',
      },
    );

    if (!confirmed) {
      return;
    }

    try {
      setDeletingStatutoryId(id);
      await api(`/payroll/statutory-config/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        body: JSON.stringify(tenantParams()),
      });
      await loadStatutoryHistory(safeText(document.state_code, stateCode));
      await loadEmployeeStatutoryReadiness(selectedEmployee);
      alerts.success('Statutory configuration draft deleted.', 'Draft Deleted');
    } catch (error) {
      alerts.error(error.message || 'Unable to delete statutory configuration draft.', 'Delete Failed');
    } finally {
      setDeletingStatutoryId('');
    }
  }

  function scrollToConfigSection(tabName, elementId) {
    if (tabName) {
      setTab(tabName);
    }
    window.setTimeout(() => {
      document.getElementById(elementId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }

  async function openStatutoryForEmployee() {
    const code = selectedEmployeeStateCode || 'ALL';
    setTab('statutory');
    setStateCode(code);
    await loadStatutoryHistory(code);
    window.setTimeout(() => {
      document.getElementById('payroll-statutory-rules')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }

  function startStatutoryRevision(source = statutoryForm) {
    const sourceDocument = source.pf ? source : statutoryFormFromDocument(source);

    setStatutoryForm({
      ...sourceDocument,
      id: '',
      status: 'draft',
      effective_from: todayInputValue(),
      effective_to: '',
      notes: '',
    });
  }

  const salarySetupComplete = Boolean(selectedEmployeeId) && salaryValidationIssues.length === 0;
  const salaryActivationComplete = Boolean(activeSalaryRevision);
  const activeEmployeeStatutoryRevision = employeeStatutoryReadiness.active_revision;
  const assamProfessionalTaxRequired = selectedEmployeeStateCode === 'AS';
  const assamProfessionalTaxConfigured = !assamProfessionalTaxRequired || Boolean(
    activeEmployeeStatutoryRevision?.professional_tax?.enabled
      && Array.isArray(activeEmployeeStatutoryRevision.professional_tax.slabs)
      && activeEmployeeStatutoryRevision.professional_tax.slabs.length > 0,
  );
  const statutorySetupComplete = Boolean(activeEmployeeStatutoryRevision)
    && assamProfessionalTaxConfigured;
  const payrollSetupReady = salaryActivationComplete && statutorySetupComplete;

  const workflowSteps = [
    {
      number: 1,
      label: 'Select employee',
      description: selectedEmployeeId ? employeeName(selectedEmployee) : 'Choose the employee whose payroll setup you want to complete.',
      status: selectedEmployeeId ? 'done' : 'current',
      action: () => scrollToConfigSection('salary', 'payroll-employee-selector'),
    },
    {
      number: 2,
      label: 'Complete salary structure',
      description: selectedEmployeeId
        ? (salarySetupComplete ? 'Salary details and components pass the configuration checks.' : `${salaryValidationIssues.length} item(s) still need attention.`)
        : 'Complete Step 1 first.',
      status: !selectedEmployeeId ? 'blocked' : salarySetupComplete ? 'done' : 'current',
      action: () => scrollToConfigSection('salary', 'payroll-salary-details'),
    },
    {
      number: 3,
      label: 'Save & activate salary',
      description: activeSalaryRevision
        ? `Active Version ${activeSalaryRevision.version || '—'}.`
        : draftSalaryRevision
          ? `Draft Version ${draftSalaryRevision.version || '—'} is waiting for activation.`
          : 'Save the completed structure as a draft, then activate it.',
      status: !salarySetupComplete ? 'blocked' : salaryActivationComplete ? 'done' : 'current',
      action: () => scrollToConfigSection('salary', 'payroll-salary-actions'),
    },
    {
      number: 4,
      label: 'Configure statutory rules',
      description: employeeStatutoryReadiness.loading
        ? 'Checking statutory configuration…'
        : activeEmployeeStatutoryRevision
          ? (!assamProfessionalTaxConfigured
              ? `Active ${employeeStatutoryReadiness.source_state_code} rules found, but Assam Professional Tax is not fully configured.`
              : `Active ${employeeStatutoryReadiness.source_state_code} statutory rules found.`)
          : selectedEmployeeStateCode
            ? `No active ${selectedEmployeeStateCode} or ALL statutory rules found.`
            : 'Employee payroll state must be configured first.',
      status: !salaryActivationComplete ? 'blocked' : statutorySetupComplete ? 'done' : 'current',
      action: openStatutoryForEmployee,
    },
    {
      number: 5,
      label: 'Process payroll',
      description: payrollSetupReady
        ? 'Core salary and statutory setup is ready. Continue to Payroll Processing.'
        : 'Complete the previous steps before calculating payroll.',
      status: payrollSetupReady ? 'ready' : 'blocked',
      action: () => { if (payrollSetupReady) setPage('payroll_runs'); },
    },
  ];

  const setupIssues = [];
  if (!selectedEmployeeId) {
    setupIssues.push({ location: 'Step 1 · Employee', message: 'Select an employee to start payroll configuration.', action: () => scrollToConfigSection('salary', 'payroll-employee-selector') });
  } else {
    salaryValidationIssues.forEach((issue) => setupIssues.push({ ...issue, action: () => scrollToConfigSection('salary', issue.location.includes('components') ? 'payroll-salary-components' : 'payroll-salary-details') }));

    if (salaryValidationIssues.length === 0 && !activeSalaryRevision) {
      setupIssues.push({
        location: 'Step 3 · Salary activation',
        message: draftSalaryRevision ? 'The salary structure is saved as Draft but has not been activated.' : 'Save the salary structure as a draft and activate it.',
        action: () => scrollToConfigSection('salary', 'payroll-salary-actions'),
      });
    }

    if (!selectedEmployeeStateCode) {
      setupIssues.push({
        location: 'Step 4 · Employee payroll state',
        message: 'Payroll state is missing or invalid on the employee record. Add a two-letter payroll/work state code before statutory rules can be resolved.',
        action: () => scrollToConfigSection('salary', 'payroll-salary-details'),
      });
    } else if (employeeStatutoryReadiness.checked && !activeEmployeeStatutoryRevision) {
      setupIssues.push({
        location: `Step 4 · Statutory rules → ${selectedEmployeeStateCode}`,
        message: employeeStatutoryReadiness.error || `No active statutory configuration was found for ${selectedEmployeeStateCode} or the ALL fallback.`,
        action: openStatutoryForEmployee,
      });
    } else if (employeeStatutoryReadiness.checked && !assamProfessionalTaxConfigured) {
      setupIssues.push({
        location: 'Step 4 · Statutory rules → Professional Tax',
        message: 'This Assam employee has an active statutory revision, but Professional Tax is disabled or has no slabs. Open the statutory rules, configure Professional Tax, save the draft, and activate the revision.',
        action: openStatutoryForEmployee,
      });
    }
  }

  return (
    <section className="payroll-config-page">
      <header className="payroll-config-hero">
        <div>
          <span className="payroll-config-eyebrow">
            <Settings2 size={15} /> Payroll Administration
          </span>
          <h1>Salary & Statutory Configuration</h1>
          <p>
            Configure employee salary revisions and effective-dated PF, ESI,
            Professional Tax and LWP rules. Employee declarations and monthly TDS
            instructions are managed separately so payroll never accepts an
            uncontrolled request-body TDS override.
          </p>
        </div>

        <div className="payroll-config-hero-actions">
          <button
            type="button"
            className="payroll-config-tax-button"
            onClick={openTaxDeclarations}
          >
            <ShieldCheck size={17} />
            Tax Declarations & TDS
          </button>

          <div className="payroll-config-hero-icon">
            <BadgeIndianRupee size={34} />
          </div>
        </div>
      </header>

      {superAdmin ? (
        <section className="payroll-config-card payroll-config-tenant-card">
          <label>
            Company tenant ID
            <input
              value={tenantId}
              onChange={(event) => setTenantId(event.target.value)}
              placeholder="Enter tenant ID"
            />
          </label>
          <button type="button" className="secondary" onClick={() => loadEmployees()}>
            {loadingEmployees ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
            Load Company
          </button>
        </section>
      ) : null}

      <section className="payroll-config-card payroll-config-roadmap">
        <div className="payroll-config-section-head">
          <div>
            <span className="payroll-config-kicker">Setup map</span>
            <h2>Payroll configuration steps</h2>
            <p>Follow the steps in order. Each incomplete item tells you exactly where to fix it.</p>
          </div>
          {payrollSetupReady ? (
            <span className="payroll-config-ready-pill"><CheckCircle2 size={15} /> Core setup ready</span>
          ) : (
            <span className="payroll-config-warning-pill"><AlertTriangle size={15} /> Setup incomplete</span>
          )}
        </div>

        <div className="payroll-config-step-map">
          {workflowSteps.map((step) => (
            <button
              type="button"
              key={step.number}
              className={`payroll-config-step status-${step.status}`}
              onClick={step.action}
              disabled={step.status === 'blocked' && step.number === 5}
            >
              <span className="payroll-config-step-number">{step.status === 'done' || step.status === 'ready' ? <CheckCircle2 size={18} /> : step.number}</span>
              <span>
                <strong>Step {step.number}: {step.label}</strong>
                <small>{step.description}</small>
              </span>
            </button>
          ))}
        </div>

        {setupIssues.length ? (
          <div className="payroll-config-issues">
            <div className="payroll-config-issues-title">
              <AlertTriangle size={18} />
              <div>
                <strong>{setupIssues.length} configuration item{setupIssues.length === 1 ? '' : 's'} need attention</strong>
                <span>Use “Go to field” to jump to the exact section.</span>
              </div>
            </div>
            <div className="payroll-config-issue-list">
              {setupIssues.map((issue, index) => (
                <article key={`${issue.location}-${index}`}>
                  <div>
                    <strong>{issue.location}</strong>
                    <p>{issue.message}</p>
                  </div>
                  <button type="button" className="secondary" onClick={issue.action}>Go to field</button>
                </article>
              ))}
            </div>
          </div>
        ) : selectedEmployeeId ? (
          <div className="payroll-config-ready-message">
            <CheckCircle2 size={18} />
            <span>Salary structure and active statutory rules are ready for {employeeName(selectedEmployee)}.</span>
            <button type="button" className="success-button" onClick={() => setPage('payroll_runs')}>Go to Payroll Processing</button>
          </div>
        ) : null}
      </section>

      <nav className="payroll-config-tabs" aria-label="Payroll configuration sections">
        <button
          type="button"
          className={tab === 'salary' ? 'active' : ''}
          onClick={() => setTab('salary')}
        >
          <Users size={17} /> Salary Structures
        </button>
        <button
          type="button"
          className={tab === 'statutory' ? 'active' : ''}
          onClick={() => setTab('statutory')}
        >
          <ShieldCheck size={17} /> Statutory Rules
        </button>
      </nav>

      {tab === 'salary' ? (
        <div className="payroll-config-layout">
          <aside ref={employeeSidebarRef} id="payroll-employee-selector" className="payroll-config-card payroll-config-sidebar">
            <div className="payroll-config-section-head">
              <div>
                <span className="payroll-config-kicker">Employee</span>
                <h2>Select employee</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => loadEmployees()}>
                {loadingEmployees ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
              </button>
            </div>

            <div className="payroll-config-search">
              <Search size={16} />
              <input
                value={employeeSearch}
                onChange={(event) => setEmployeeSearch(event.target.value)}
                placeholder="Search employee"
              />
            </div>

            <div className="payroll-config-employee-list">
              {filteredEmployees.map((employee) => {
                const id = employeeId(employee);
                return (
                  <button
                    type="button"
                    key={id}
                    className={selectedEmployeeId === id ? 'active' : ''}
                    onClick={() => selectEmployee(id)}
                  >
                    <strong>{employeeName(employee)}</strong>
                    <span>{employeeCode(employee)} · {safeText(employee.designation, 'No designation')}</span>
                  </button>
                );
              })}

              {!loadingEmployees && filteredEmployees.length === 0 ? (
                <div className="payroll-config-empty">No employees found.</div>
              ) : null}
            </div>
          </aside>

          <main ref={payrollMainRef} className="payroll-config-main">
            {!selectedEmployeeId ? (
              <section className="payroll-config-card payroll-config-placeholder">
                <Users size={34} />
                <h2>Select an employee</h2>
                <p>Choose an employee to create or revise their salary structure.</p>
              </section>
            ) : (
              <>
                {salaryValidationIssues.length ? (
                  <section className="payroll-config-inline-issues">
                    <AlertTriangle size={19} />
                    <div>
                      <strong>Salary setup needs attention</strong>
                      <ul>
                        {salaryValidationIssues.map((issue, index) => (
                          <li key={`${issue.location}-${index}`}><b>{issue.location}</b>: {issue.message}</li>
                        ))}
                      </ul>
                    </div>
                  </section>
                ) : null}

                <section id="payroll-salary-details" className="payroll-config-card">
                  <div className="payroll-config-section-head">
                    <div>
                      <span className="payroll-config-kicker">Salary revision</span>
                      <h2>{employeeName(selectedEmployee)}</h2>
                      <p>{employeeCode(selectedEmployee)}</p>
                    </div>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => startSalaryRevision()}
                    >
                      <Plus size={16} /> New Revision
                    </button>
                  </div>

                  {loadingSalary ? (
                    <div className="payroll-config-loading"><Loader2 className="spin" /> Loading salary structure…</div>
                  ) : (
                    <div className="payroll-config-form-grid">
                      <label>
                        Structure name
                        <input
                          value={salaryForm.structure_name}
                          onChange={(event) => updateSalaryField('structure_name', event.target.value)}
                        />
                      </label>
                      <label>
                        State code
                        <input
                          value={salaryForm.state_code}
                          maxLength={3}
                          onChange={(event) =>
                            updateSalaryField('state_code', event.target.value.toUpperCase())
                          }
                          placeholder="ALL or AS"
                        />
                      </label>
                      <label>
                        Effective from
                        <input
                          type="date"
                          value={salaryForm.effective_from}
                          onChange={(event) => updateSalaryField('effective_from', event.target.value)}
                        />
                      </label>
                      <label>
                        Effective to (optional)
                        <input
                          type="date"
                          value={salaryForm.effective_to}
                          onChange={(event) => updateSalaryField('effective_to', event.target.value)}
                        />
                      </label>
                      <label>
                        Monthly CTC
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={salaryForm.monthly_ctc}
                          onChange={(event) => updateSalaryField('monthly_ctc', event.target.value)}
                        />
                      </label>
                      <label>
                        Annual CTC
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={salaryForm.annual_ctc}
                          onChange={(event) => updateSalaryField('annual_ctc', event.target.value)}
                        />
                      </label>
                    </div>
                  )}
                </section>

                <section id="payroll-salary-components" className="payroll-config-card">
                  <div className="payroll-config-section-head">
                    <div>
                      <span className="payroll-config-kicker">Dynamic breakup</span>
                      <h2>Salary components</h2>
                      <p>SDS formula: Basic 50% of Gross, HRA 50% of Basic, Medical 40% of Basic, Other Allowance 10% of Basic.</p>
                    </div>
                    <button type="button" className="secondary" onClick={addComponent}>
                      <Plus size={16} /> Add Component
                    </button>
                  </div>

                  <div className="payroll-component-list">
                    {salaryForm.components.map((component, index) => {
                      const expanded = expandedComponent === index;
                      const isSdsRequiredComponent = REQUIRED_EARNING_CODES.has(normalizeKey(component.code));
                      return (
                        <article className="payroll-component-row" key={component.editor_id || `salary-component-${index}`}>
                          <button
                            type="button"
                            className="payroll-component-summary"
                            onClick={() => setExpandedComponent(expanded ? -1 : index)}
                          >
                            <span className="payroll-component-number">{index + 1}</span>
                            <span>
                              <strong>{component.label || 'New component'}</strong>
                              <small>
                                {statusLabel(component.category)} · {statusLabel(component.calculation_type)}
                              </small>
                            </span>
                            <span className="payroll-component-summary-value">
                              {component.calculation_type === 'fixed'
                                ? formatCurrency(component.amount)
                                : component.calculation_type === 'percentage'
                                  ? `${component.percentage || 0}% of ${component.base_component || 'monthly_ctc'}`
                                  : statusLabel(component.calculation_type)}
                            </span>
                            {expanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
                          </button>

                          {expanded ? (
                            <div className="payroll-component-editor">
                              <div className="payroll-config-form-grid payroll-config-form-grid-3">
                                <label>
                                  Component code
                                  <input
                                    value={component.code}
                                    onChange={(event) => updateComponent(index, 'code', event.currentTarget.value)}
                                    placeholder="component_code"
                                    autoComplete="off"
                                    spellCheck={false}
                                    disabled={isSdsRequiredComponent}
                                  />
                                </label>
                                <label>
                                  Display label
                                  <input
                                    value={component.label}
                                    onChange={(event) => updateComponent(index, 'label', event.currentTarget.value)}
                                    autoComplete="off"
                                  />
                                </label>
                                <label>
                                  Category
                                  <select
                                    value={component.category}
                                    onChange={(event) => updateComponent(index, 'category', event.target.value)}
                                    disabled={isSdsRequiredComponent}
                                  >
                                    {COMPONENT_CATEGORIES.map(([value, label]) => (
                                      <option key={value} value={value}>{label}</option>
                                    ))}
                                  </select>
                                </label>
                                <label>
                                  Calculation type
                                  <select
                                    value={component.calculation_type}
                                    onChange={(event) =>
                                      updateComponent(index, 'calculation_type', event.target.value)
                                    }
                                    disabled={isSdsRequiredComponent}
                                  >
                                    {CALCULATION_TYPES.map(([value, label]) => (
                                      <option key={value} value={value}>{label}</option>
                                    ))}
                                  </select>
                                </label>

                                {component.calculation_type === 'fixed' ? (
                                  <label>
                                    Monthly amount
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={component.amount}
                                      onChange={(event) => updateComponent(index, 'amount', event.target.value)}
                                    />
                                  </label>
                                ) : null}

                                {component.calculation_type === 'percentage' ? (
                                  <>
                                    <label>
                                      Percentage
                                      <input
                                        type="number"
                                        min="0"
                                        max="100"
                                        step="0.0001"
                                        value={component.percentage}
                                        onChange={(event) =>
                                          updateComponent(index, 'percentage', event.target.value)
                                        }
                                        disabled={isSdsRequiredComponent}
                                      />
                                    </label>
                                    <label>
                                      Percentage base
                                      <input
                                        value={component.base_component}
                                        onChange={(event) =>
                                          updateComponent(index, 'base_component', event.target.value)
                                        }
                                        placeholder="basic or gross_salary"
                                        disabled={isSdsRequiredComponent}
                                      />
                                    </label>
                                  </>
                                ) : null}

                                {component.calculation_type === 'balancing' ? (
                                  <>
                                    <label>
                                      Balance of
                                      <input
                                        value={component.balance_of}
                                        onChange={(event) =>
                                          updateComponent(index, 'balance_of', event.target.value)
                                        }
                                      />
                                    </label>
                                    <label>
                                      Minimum amount
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={component.minimum_amount}
                                        onChange={(event) =>
                                          updateComponent(index, 'minimum_amount', event.target.value)
                                        }
                                      />
                                    </label>
                                  </>
                                ) : null}

                                {component.calculation_type === 'statutory' ? (
                                  <label>
                                    Statutory rule code
                                    <input
                                      value={component.statutory_rule}
                                      onChange={(event) =>
                                        updateComponent(index, 'statutory_rule', event.target.value)
                                      }
                                      placeholder="pf_employer"
                                    />
                                  </label>
                                ) : null}
                              </div>

                              <div className="payroll-config-check-grid">
                                {[
                                  ['prorate_on_lwp', 'Prorate on LWP'],
                                  ['include_in_gross', 'Include in Gross'],
                                  ['include_in_ctc', 'Include in CTC'],
                                  ['show_in_earnings', 'Show in Earnings'],
                                  ['show_in_deductions', 'Show in Deductions'],
                                  ['taxable', 'Taxable'],
                                  ['is_active', 'Active'],
                                ].map(([field, label]) => (
                                  <label className="payroll-config-check" key={field}>
                                    <input
                                      type="checkbox"
                                      checked={Boolean(component[field])}
                                      onChange={(event) =>
                                        updateComponent(index, field, event.target.checked)
                                      }
                                      disabled={isSdsRequiredComponent && field !== 'taxable'}
                                    />
                                    {label}
                                  </label>
                                ))}
                              </div>

                              {isSdsRequiredComponent ? (
                                <div className="payroll-config-notice">
                                  <ShieldCheck size={16} />
                                  This required SDS earning follows the approved payroll formula and is locked here.
                                </div>
                              ) : null}

                              <div className="payroll-component-actions">
                                <button
                                  type="button"
                                  className="danger-light"
                                  onClick={() => removeComponent(index)}
                                >
                                  <Trash2 size={15} /> Remove
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                </section>

                <section id="payroll-salary-actions" className="payroll-config-card">
                  {salaryForm.id && normalizeKey(salaryForm.status) !== 'draft' ? (
                    <div className="payroll-config-notice">
                      <AlertTriangle size={16} />
                      You are viewing an active/superseded revision. Use “New Revision” before changing and saving it.
                    </div>
                  ) : null}
                  <label>
                    Revision notes
                    <textarea
                      rows="3"
                      value={salaryForm.notes}
                      onChange={(event) => updateSalaryField('notes', event.target.value)}
                      placeholder="Reason for this salary revision"
                    />
                  </label>

                  <div className="payroll-config-actions">
                    <button
                      type="button"
                      className="primary"
                      onClick={saveSalaryDraft}
                      disabled={savingSalary || (salaryForm.id && normalizeKey(salaryForm.status) !== 'draft')}
                    >
                      {savingSalary ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
                      Save Draft
                    </button>
                    <button
                      type="button"
                      className="success-button"
                      disabled={!salaryForm.id || normalizeKey(salaryForm.status) !== 'draft' || savingSalary}
                      onClick={() => activateSalaryDraft()}
                    >
                      <CheckCircle2 size={16} /> Activate Revision
                    </button>
                  </div>
                </section>

                <section className="payroll-config-card">
                  <div className="payroll-config-section-head">
                    <div>
                      <span className="payroll-config-kicker">Audit history</span>
                      <h2>Salary revision history</h2>
                    </div>
                    <FileClock size={22} />
                  </div>

                  <div className="payroll-config-history">
                    {salaryHistory.map((item) => (
                      <article key={documentId(item)}>
                        <div>
                          <strong>Version {item.version || '—'}</strong>
                          <span className={`payroll-config-status status-${normalizeKey(item.status)}`}>
                            {statusLabel(item.status)}
                          </span>
                        </div>
                        <p>
                          {formatDate(item.effective_from)} – {item.effective_to ? formatDate(item.effective_to) : 'Open ended'}
                        </p>
                        <p>{formatCurrency(item.monthly_ctc)} monthly CTC</p>
                        <div className="payroll-config-history-actions">
                          {normalizeKey(item.status) === 'draft' ? (
                            <>
                              <button type="button" className="secondary" onClick={() => { setSalaryForm(salaryFormFromDocument(item)); scrollToConfigSection('salary', 'payroll-salary-details'); }}>
                                Edit Draft
                              </button>
                              <button
                                type="button"
                                className="danger-light"
                                disabled={deletingSalaryId === documentId(item)}
                                onClick={() => deleteSalaryDraft(item)}
                              >
                                {deletingSalaryId === documentId(item) ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />} Delete Draft
                              </button>
                            </>
                          ) : normalizeKey(item.status) === 'active' ? (
                            <>
                              <button type="button" className="secondary" onClick={() => startSalaryRevision(salaryFormFromDocument(item))}>
                                Use for New Revision
                              </button>
                              <button
                                type="button"
                                className="danger-light"
                                disabled={deletingSalaryId === documentId(item)}
                                onClick={() => deleteActiveSalaryRevision(item)}
                              >
                                {deletingSalaryId === documentId(item) ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />} Delete Active
                              </button>
                            </>
                          ) : (
                            <button type="button" className="secondary" onClick={() => startSalaryRevision(salaryFormFromDocument(item))}>
                              Use for New Revision
                            </button>
                          )}
                        </div>
                      </article>
                    ))}

                    {salaryHistory.length === 0 ? (
                      <div className="payroll-config-empty">No salary revisions recorded yet.</div>
                    ) : null}
                  </div>
                </section>
              </>
            )}
          </main>
        </div>
      ) : (
        <div id="payroll-statutory-rules" className="payroll-config-main payroll-config-statutory-main">
          <section className="payroll-config-card">
            <div className="payroll-config-section-head">
              <div>
                <span className="payroll-config-kicker">Effective-dated rules</span>
                <h2>State / national configuration</h2>
                <p>Use ALL for national defaults and a two-letter state code for state-specific rules.</p>
              </div>
              <button type="button" className="secondary" onClick={() => startStatutoryRevision()}>
                <Plus size={16} /> New Revision
              </button>
            </div>

            <div className="payroll-config-state-loader">
              <label>
                State code
                <input
                  value={stateCode}
                  maxLength={3}
                  onChange={(event) => setStateCode(event.target.value.toUpperCase())}
                  placeholder="ALL or AS"
                />
              </label>
              <button type="button" className="secondary" onClick={() => loadStatutoryHistory(stateCode)}>
                {loadingStatutory ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
                Load Rules
              </button>
            </div>
          </section>

          {statutoryValidationIssues.length ? (
            <section className="payroll-config-inline-issues">
              <AlertTriangle size={19} />
              <div>
                <strong>Statutory setup needs attention</strong>
                <ul>
                  {statutoryValidationIssues.map((issue, index) => (
                    <li key={`${issue.location}-${index}`}><b>{issue.location}</b>: {issue.message}</li>
                  ))}
                </ul>
              </div>
            </section>
          ) : null}

          <section className="payroll-config-card">
            <div className="payroll-config-form-grid">
              <label>
                Configuration state code
                <input
                  value={statutoryForm.state_code}
                  maxLength={3}
                  onChange={(event) =>
                    setStatutoryForm((current) => ({
                      ...current,
                      state_code: event.target.value.toUpperCase(),
                    }))
                  }
                />
              </label>
              <label>
                State name
                <input
                  value={statutoryForm.state_name}
                  onChange={(event) =>
                    setStatutoryForm((current) => ({
                      ...current,
                      state_name: event.target.value,
                    }))
                  }
                  placeholder="National default or Assam"
                />
              </label>
              <label>
                Effective from
                <input
                  type="date"
                  value={statutoryForm.effective_from}
                  onChange={(event) =>
                    setStatutoryForm((current) => ({
                      ...current,
                      effective_from: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Effective to (optional)
                <input
                  type="date"
                  value={statutoryForm.effective_to}
                  onChange={(event) =>
                    setStatutoryForm((current) => ({
                      ...current,
                      effective_to: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Rounding mode
                <select
                  value={statutoryForm.rounding_mode}
                  onChange={(event) =>
                    setStatutoryForm((current) => ({
                      ...current,
                      rounding_mode: event.target.value,
                    }))
                  }
                >
                  <option value="nearest_rupee">Nearest Rupee</option>
                  <option value="two_decimals">Two Decimals</option>
                  <option value="floor">Floor</option>
                  <option value="ceil">Ceiling</option>
                </select>
              </label>
              <label>
                Source / notification reference
                <input
                  value={statutoryForm.source_reference}
                  onChange={(event) =>
                    setStatutoryForm((current) => ({
                      ...current,
                      source_reference: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
          </section>

          <div className="payroll-config-rule-grid">
            <section className="payroll-config-card payroll-config-rule-card">
              <div className="payroll-config-rule-head">
                <div><ShieldCheck size={20} /><h2>Provident Fund</h2></div>
                <label className="payroll-switch">
                  <input
                    type="checkbox"
                    checked={statutoryForm.pf.enabled}
                    onChange={(event) => updateStatutorySection('pf', 'enabled', event.target.checked)}
                  />
                  <span>Enabled</span>
                </label>
              </div>

              <div className="payroll-config-form-grid">
                <label>
                  Employee rate (%)
                  <input type="number" value={SDS_PF_RULE.employee_rate_percent} disabled />
                </label>
                <label>
                  Employer rate (%)
                  <input type="number" value={SDS_PF_RULE.employer_rate_percent} disabled />
                </label>
                <label>
                  Wage ceiling
                  <input type="number" value={SDS_PF_RULE.wage_ceiling} disabled />
                </label>
                <label>
                  Wage-base component codes
                  <input value={SDS_PF_RULE.wage_base_component_codes} disabled />
                </label>
              </div>

              <div className="payroll-config-notice">
                <ShieldCheck size={16} />
                SDS PF is fixed at 12% employee + 12% employer on Basic + HRA + Medical Allowance, capped at ₹15,000 PF wage. Higher-wage override is not permitted.
              </div>

              <div className="payroll-config-check-grid">
                {[
                  ['show_employer_pf_as_earning', 'Show employer PF in earnings'],
                  ['show_employer_pf_as_deduction', 'Show employer PF in deductions'],
                ].map(([field, label]) => (
                  <label className="payroll-config-check" key={field}>
                    <input type="checkbox" checked={Boolean(statutoryForm.pf[field])} onChange={(event) => updateStatutorySection('pf', field, event.target.checked)} />
                    {label}
                  </label>
                ))}
              </div>
            </section>

            <section className="payroll-config-card payroll-config-rule-card">
              <div className="payroll-config-rule-head">
                <div><Activity size={20} /><h2>ESI</h2></div>
                <label className="payroll-switch">
                  <input type="checkbox" checked={statutoryForm.esi.enabled} onChange={(event) => updateStatutorySection('esi', 'enabled', event.target.checked)} />
                  <span>Enabled</span>
                </label>
              </div>

              <div className="payroll-config-form-grid">
                <label>
                  Employee rate (%)
                  <input type="number" min="0" max="100" step="0.0001" value={statutoryForm.esi.employee_rate_percent} onChange={(event) => updateStatutorySection('esi', 'employee_rate_percent', event.target.value)} />
                </label>
                <label>
                  Employer rate (%)
                  <input type="number" min="0" max="100" step="0.0001" value={statutoryForm.esi.employer_rate_percent} onChange={(event) => updateStatutorySection('esi', 'employer_rate_percent', event.target.value)} />
                </label>
                <label>
                  Wage ceiling
                  <input type="number" min="0" step="0.01" value={statutoryForm.esi.wage_ceiling} onChange={(event) => updateStatutorySection('esi', 'wage_ceiling', event.target.value)} />
                </label>
                <label>
                  Wage base
                  <input value={statutoryForm.esi.wage_base} onChange={(event) => updateStatutorySection('esi', 'wage_base', event.target.value)} />
                </label>
              </div>
            </section>
          </div>

          <section className="payroll-config-card">
            <div className="payroll-config-rule-head">
              <div><BadgeIndianRupee size={20} /><h2>Professional Tax</h2></div>
              <div className="payroll-config-rule-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={applyAssamProfessionalTaxPreset}
                >
                  Load Assam Apr 2025 Preset
                </button>

                <label className="payroll-switch">
                  <input type="checkbox" checked={statutoryForm.professional_tax.enabled} onChange={(event) => updateStatutorySection('professional_tax', 'enabled', event.target.checked)} />
                  <span>Enabled</span>
                </label>
              </div>
            </div>

            {safeText(statutoryForm.state_code).toUpperCase() === 'AS' ? (
              <div className="payroll-config-info-notice">
                <CheckCircle2 size={17} />
                <span>
                  Assam preset boundaries: gross salary up to ₹15,000 = ₹0;
                  above ₹15,000 and below ₹25,000 = ₹180; ₹25,000 and above = ₹208.
                  The preset loads the Assam Professional Tax slab values introduced
                  for April 2025. It preserves the Effective from date already selected
                  for this revision.
                </span>
              </div>
            ) : null}

            <div className="payroll-config-inline-field">
              <label>
                Calculation basis
                <input value={statutoryForm.professional_tax.basis} onChange={(event) => updateStatutorySection('professional_tax', 'basis', event.target.value)} />
              </label>
              <button type="button" className="secondary" onClick={addPtSlab}>
                <Plus size={16} /> Add Slab
              </button>
            </div>

            <div className="payroll-pt-table-wrap">
              <table className="payroll-pt-table">
                <thead>
                  <tr>
                    <th>Minimum</th>
                    <th>Maximum</th>
                    <th>Tax amount</th>
                    <th>Min inclusive</th>
                    <th>Max inclusive</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {statutoryForm.professional_tax.slabs.map((slab, index) => (
                    <tr key={`pt-${index}`}>
                      <td><input type="number" min="0" step="0.01" value={slab.minimum_amount} onChange={(event) => updatePtSlab(index, 'minimum_amount', event.target.value)} /></td>
                      <td><input type="number" min="0" step="0.01" value={slab.maximum_amount} onChange={(event) => updatePtSlab(index, 'maximum_amount', event.target.value)} placeholder="Blank = no maximum" /></td>
                      <td><input type="number" min="0" step="0.01" value={slab.tax_amount} onChange={(event) => updatePtSlab(index, 'tax_amount', event.target.value)} /></td>
                      <td><input type="checkbox" checked={slab.minimum_inclusive} onChange={(event) => updatePtSlab(index, 'minimum_inclusive', event.target.checked)} /></td>
                      <td><input type="checkbox" checked={slab.maximum_inclusive} onChange={(event) => updatePtSlab(index, 'maximum_inclusive', event.target.checked)} /></td>
                      <td><button type="button" className="icon-button danger-icon" onClick={() => removePtSlab(index)}><Trash2 size={15} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {statutoryForm.professional_tax.slabs.length === 0 ? (
                <div className="payroll-config-empty">No Professional Tax slabs added.</div>
              ) : null}
            </div>
          </section>

          <div className="payroll-config-rule-grid">
            <section className="payroll-config-card payroll-config-rule-card">
              <div className="payroll-config-section-head">
                <div>
                  <span className="payroll-config-kicker">Company policy metadata</span>
                  <h2>TDS Handling</h2>
                </div>

                <button
                  type="button"
                  className="secondary"
                  onClick={openTaxDeclarations}
                >
                  Manage Employee TDS
                </button>
              </div>

              <div className="payroll-config-form-grid">
                <label>
                  Default policy mode
                  <select value={statutoryForm.tds.mode} onChange={(event) => updateStatutorySection('tds', 'mode', event.target.value)}>
                    <option value="disabled">Disabled</option>
                    <option value="manual">Manual Instruction</option>
                    <option value="external">External Instruction</option>
                  </select>
                </label>
                <label>
                  Policy source
                  <input value={statutoryForm.tds.source} onChange={(event) => updateStatutorySection('tds', 'source', event.target.value)} placeholder="payroll_tax_instruction" />
                </label>
              </div>

              <div className="payroll-config-notice">
                <AlertTriangle size={17} />
                <span>
                  This section stores company-level policy metadata only. The
                  authoritative monthly amount comes from the active employee TDS
                  instruction in Tax Declarations & TDS. Automatic slab calculation
                  remains disabled.
                </span>
              </div>
            </section>

            <section className="payroll-config-card payroll-config-rule-card">
              <h2>LWP Proration</h2>
              <div className="payroll-config-form-grid">
                <label>
                  Divisor mode
                  <select value={statutoryForm.lwp.divisor_mode} onChange={(event) => updateStatutorySection('lwp', 'divisor_mode', event.target.value)}>
                    <option value="">Choose explicitly</option>
                    <option value="calendar_days">Calendar Days</option>
                    <option value="fixed_days">Fixed Days</option>
                    <option value="working_days">Working Days</option>
                  </select>
                </label>
                {statutoryForm.lwp.divisor_mode === 'fixed_days' ? (
                  <label>
                    Fixed divisor days
                    <input type="number" min="1" max="31" value={statutoryForm.lwp.fixed_days} onChange={(event) => updateStatutorySection('lwp', 'fixed_days', event.target.value)} />
                  </label>
                ) : null}
                <label className="payroll-config-span-2">
                  Prorated component codes
                  <input value={statutoryForm.lwp.prorate_component_codes} onChange={(event) => updateStatutorySection('lwp', 'prorate_component_codes', event.target.value)} />
                </label>
              </div>
            </section>
          </div>

          <section className="payroll-config-card">
            {statutoryForm.id && normalizeKey(statutoryForm.status) !== 'draft' ? (
              <div className="payroll-config-notice">
                <AlertTriangle size={16} />
                You are viewing an active/superseded statutory revision. Use “New Revision” before changing and saving it.
              </div>
            ) : null}
            <label>
              Configuration notes
              <textarea rows="3" value={statutoryForm.notes} onChange={(event) => setStatutoryForm((current) => ({ ...current, notes: event.target.value }))} />
            </label>

            <div className="payroll-config-actions">
              <button
                type="button"
                className="primary"
                onClick={saveStatutoryDraft}
                disabled={savingStatutory || (statutoryForm.id && normalizeKey(statutoryForm.status) !== 'draft')}
              >
                {savingStatutory ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
                Save Draft
              </button>
              <button type="button" className="success-button" disabled={!statutoryForm.id || normalizeKey(statutoryForm.status) !== 'draft' || savingStatutory} onClick={() => activateStatutoryDraft()}>
                <CheckCircle2 size={16} /> Activate Revision
              </button>
            </div>
          </section>

          <section className="payroll-config-card">
            <div className="payroll-config-section-head">
              <div>
                <span className="payroll-config-kicker">Audit history</span>
                <h2>Statutory revision history</h2>
              </div>
              <FileClock size={22} />
            </div>

            <div className="payroll-config-history payroll-config-history-wide">
              {statutoryHistory.map((item) => (
                <article key={documentId(item)}>
                  <div>
                    <strong>{item.state_code} · Version {item.version || '—'}</strong>
                    <span className={`payroll-config-status status-${normalizeKey(item.status)}`}>
                      {statusLabel(item.status)}
                    </span>
                  </div>
                  <p>{formatDate(item.effective_from)} – {item.effective_to ? formatDate(item.effective_to) : 'Open ended'}</p>
                  <p>PF {item.pf?.enabled ? 'enabled' : 'disabled'} · PT {item.professional_tax?.enabled ? 'enabled' : 'disabled'} · ESI {item.esi?.enabled ? 'enabled' : 'disabled'}</p>
                  <div className="payroll-config-history-actions">
                    {normalizeKey(item.status) === 'draft' ? (
                      <>
                        <button type="button" className="secondary" onClick={() => { setStatutoryForm(statutoryFormFromDocument(item)); scrollToConfigSection('statutory', 'payroll-statutory-rules'); }}>Edit Draft</button>
                        <button
                          type="button"
                          className="danger-light"
                          disabled={deletingStatutoryId === documentId(item)}
                          onClick={() => deleteStatutoryDraft(item)}
                        >
                          {deletingStatutoryId === documentId(item) ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />} Delete Draft
                        </button>
                      </>
                    ) : normalizeKey(item.status) === 'active' ? (
                      <>
                        <button type="button" className="secondary" onClick={() => startStatutoryRevision(statutoryFormFromDocument(item))}>Use for New Revision</button>
                        <button
                          type="button"
                          className="danger-light"
                          disabled={deletingStatutoryId === documentId(item)}
                          onClick={() => deleteActiveStatutoryRevision(item)}
                          title="Delete an accidentally activated statutory revision"
                        >
                          {deletingStatutoryId === documentId(item) ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />} Delete Active
                        </button>
                      </>
                    ) : normalizeKey(item.status) === 'superseded' ? (
                      <>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => {
                            startStatutoryRevision(statutoryFormFromDocument(item));
                            scrollToConfigSection('statutory', 'payroll-statutory-rules');
                          }}
                          title="Create a new editable draft using this superseded revision as the base"
                        >
                          Edit / New Draft
                        </button>
                        <button
                          type="button"
                          className="danger-light"
                          disabled={deletingStatutoryId === documentId(item)}
                          onClick={() => deleteSupersededStatutoryRevision(item)}
                          title="Delete this superseded revision if no payroll history depends on it"
                        >
                          {deletingStatutoryId === documentId(item) ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />} Delete Superseded
                        </button>
                      </>
                    ) : (
                      <button type="button" className="secondary" onClick={() => startStatutoryRevision(statutoryFormFromDocument(item))}>Use for New Revision</button>
                    )}
                  </div>
                </article>
              ))}

              {statutoryHistory.length === 0 ? (
                <div className="payroll-config-empty">Load a state code to view its revision history.</div>
              ) : null}
            </div>
          </section>
        </div>
      )}

      <style>{`

        .payroll-config-page {
          --pc-ink: #101a3a;
          --pc-copy: #5d6d8d;
          --pc-violet: #6658dc;
          --pc-violet-deep: #40348d;
          --pc-blue: #3766db;
          --pc-cyan: #18b5c8;
          --pc-teal: #34c9c4;
          --pc-danger: #d84d68;
          --pc-line: rgba(16, 26, 58, .14);

          display: grid;
          gap: clamp(18px, 2vw, 26px);
          width: 100%;
          min-width: 0;
          max-width: 100%;
          color: var(--pc-ink);
        }

        .payroll-config-page *,
        .payroll-config-page *::before,
        .payroll-config-page *::after {
          box-sizing: border-box;
        }

        .payroll-config-page > *,
        .payroll-config-card,
        .payroll-config-hero,
        .payroll-config-layout,
        .payroll-config-main,
        .payroll-config-sidebar,
        .payroll-config-rule-grid,
        .payroll-config-rule-card,
        .payroll-config-form-grid,
        .payroll-config-history,
        .payroll-component-row,
        .payroll-component-editor,
        .payroll-pt-table-wrap {
          width: 100%;
          min-width: 0;
          max-width: 100%;
        }

        .payroll-config-page img,
        .payroll-config-page input,
        .payroll-config-page select,
        .payroll-config-page textarea,
        .payroll-config-page button {
          max-width: 100%;
        }

        .payroll-config-page::before,
        .payroll-config-page::after,
        .payroll-config-card::before,
        .payroll-config-card::after,
        .payroll-component-row::before,
        .payroll-component-row::after {
          content: none !important;
          display: none !important;
        }

        .payroll-config-hero {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: center;
          gap: clamp(22px, 3vw, 40px);
          min-height: 275px;
          padding: clamp(25px, 3vw, 42px);
          border: 1px solid rgba(154, 164, 205, .58);
          border-radius: clamp(28px, 2.7vw, 40px);
          background: linear-gradient(135deg, #eef9ff 0%, #f8f3ff 52%, #effbf8 100%);
          color: var(--pc-ink);
          box-shadow:
            12px 14px 0 #c6d8f7,
            0 28px 48px rgba(34, 38, 110, .13);
        }

        .payroll-config-hero > div:first-child {
          min-width: 0;
        }

        .payroll-config-eyebrow,
        .payroll-config-kicker {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          width: max-content;
          max-width: 100%;
          color: #fff;
          background: #342b78;
          font-size: 9px;
          font-weight: 950;
          line-height: 1;
          letter-spacing: .12em;
          text-transform: uppercase;
        }

        .payroll-config-eyebrow {
          margin-bottom: 15px;
          padding: 9px 13px;
          border-radius: 999px;
          box-shadow: 4px 5px 0 #18b5c8;
        }

        .payroll-config-kicker {
          margin-bottom: 10px;
          padding: 7px 10px;
          border-radius: 999px;
          box-shadow: 3px 4px 0 #18b5c8;
        }

        .payroll-config-hero h1 {
          max-width: 900px;
          margin: 0;
          color: var(--pc-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(44px, 5.2vw, 77px);
          font-weight: 760;
          line-height: .94;
          letter-spacing: -.058em;
          overflow-wrap: anywhere;
        }

        .payroll-config-hero p {
          max-width: 820px;
          margin: 17px 0 0;
          color: var(--pc-copy);
          font-size: clamp(13px, 1vw, 16px);
          line-height: 1.68;
        }

        .payroll-config-hero-actions {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 14px;
          min-width: 0;
        }

        .payroll-config-tax-button,
        .payroll-config-page .primary,
        .payroll-config-page .secondary,
        .payroll-config-page .success-button,
        .payroll-config-page .danger-light,
        .payroll-config-page .icon-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-height: 44px;
          padding: 10px 15px;
          border-radius: 15px;
          font: inherit;
          font-size: 11px;
          font-weight: 900;
          cursor: pointer;
          transition:
            transform 190ms cubic-bezier(.22,1,.36,1),
            box-shadow 190ms ease,
            filter 190ms ease,
            opacity 190ms ease,
            background 190ms ease,
            border-color 190ms ease;
        }

        .payroll-config-tax-button {
          min-height: 54px;
          padding-inline: 18px;
          border: 1px solid rgba(65,55,161,.18);
          color: #40348d;
          background: rgba(255,255,255,.92);
          box-shadow:
            6px 7px 0 #b9d7ff,
            0 14px 25px rgba(44,75,116,.10);
        }

        @media (hover: hover) and (pointer: fine) {
          .payroll-config-tax-button:hover:not(:disabled),
          .payroll-config-page .primary:hover:not(:disabled),
          .payroll-config-page .secondary:hover:not(:disabled),
          .payroll-config-page .success-button:hover:not(:disabled),
          .payroll-config-page .danger-light:hover:not(:disabled),
          .payroll-config-page .icon-button:hover:not(:disabled),
          .payroll-config-card:hover,
          .payroll-config-step:hover:not(:disabled),
          .payroll-component-row:hover,
          .payroll-config-history article:hover {
            transform: translateY(-2px);
          }
        }

        .payroll-config-hero-icon {
          display: grid;
          width: 76px;
          height: 76px;
          flex: 0 0 76px;
          place-items: center;
          border: 1px solid rgba(102,88,220,.18);
          border-radius: 22px;
          color: var(--pc-violet);
          background: rgba(255,255,255,.92);
          box-shadow:
            6px 7px 0 #c9c0ff,
            0 14px 25px rgba(44,75,116,.10);
        }

        .payroll-config-card {
          min-width: 0;
          padding: clamp(20px, 2vw, 28px);
          border: 1px solid rgba(171,181,211,.70);
          border-radius: clamp(26px, 2.2vw, 36px);
          background: linear-gradient(145deg, #ffffff, #f7fbff);
          box-shadow:
            8px 10px 0 #c4ccff,
            0 24px 42px rgba(34,38,110,.10);
          transition:
            transform 210ms cubic-bezier(.22,1,.36,1),
            box-shadow 210ms ease,
            border-color 210ms ease;
        }

        .payroll-config-tenant-card,
        .payroll-config-state-loader,
        .payroll-config-inline-field,
        .payroll-config-actions {
          display: flex;
          align-items: end;
          gap: 12px;
          flex-wrap: wrap;
        }

        .payroll-config-tenant-card label,
        .payroll-config-state-loader label,
        .payroll-config-inline-field label {
          flex: 1 1 260px;
          min-width: 0;
        }

        .payroll-config-roadmap {
          display: grid;
          gap: 18px;
        }

        .payroll-config-section-head,
        .payroll-config-rule-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          margin-bottom: 18px;
        }

        .payroll-config-section-head > div,
        .payroll-config-rule-head > div {
          min-width: 0;
        }

        .payroll-config-section-head > svg {
          width: 26px;
          height: 26px;
          padding: 4px;
          flex: 0 0 26px;
          margin-left: auto;
          border: 1px solid rgba(102,88,220,.18);
          border-radius: 8px;
          color: var(--pc-violet);
          background: rgba(255,255,255,.92);
          box-shadow: 2px 3px 0 rgba(52,43,120,.08);
        }

        .payroll-config-section-head h2,
        .payroll-config-rule-head h2,
        .payroll-config-rule-card > h2 {
          margin: 0;
          color: var(--pc-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(25px, 2.3vw, 37px);
          font-weight: 760;
          line-height: 1;
          letter-spacing: -.045em;
        }

        .payroll-config-section-head p {
          margin: 8px 0 0;
          color: var(--pc-copy);
          font-size: 13px;
          line-height: 1.58;
        }

        .payroll-config-ready-pill,
        .payroll-config-warning-pill,
        .payroll-config-status {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          width: fit-content;
          max-width: 100%;
          padding: 7px 10px;
          border-radius: 999px;
          font-size: 10px;
          font-weight: 900;
          white-space: nowrap;
        }

        .payroll-config-ready-pill,
        .status-active {
          border: 1px solid rgba(40,90,74,.16);
          color: #166534;
          background: #eaf8f4;
        }

        .payroll-config-warning-pill,
        .payroll-config-status {
          border: 1px solid rgba(138,90,23,.15);
          color: #805b00;
          background: #fff4d5;
        }

        .status-superseded,
        .status-archived {
          border-color: rgba(93,103,133,.14);
          color: #5d6785;
          background: #edf2f8;
        }

        .payroll-config-step-map {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 14px;
        }

        .payroll-config-step {
          display: flex;
          min-width: 0;
          min-height: 118px;
          align-items: flex-start;
          gap: 11px;
          padding: 16px;
          border: 1px solid rgba(171,181,211,.66);
          border-radius: 22px;
          color: var(--pc-ink);
          background: #edf6ff;
          box-shadow:
            6px 8px 0 #b9d7ff,
            0 18px 30px rgba(34,38,110,.08);
          text-align: left;
          cursor: pointer;
          transition: transform 190ms ease, box-shadow 190ms ease, border-color 190ms ease;
        }

        .payroll-config-step:nth-child(2) {
          background: #fff4d5;
          box-shadow: 6px 8px 0 #ffe0a5, 0 18px 30px rgba(34,38,110,.08);
        }

        .payroll-config-step:nth-child(3) {
          background: #f1efff;
          box-shadow: 6px 8px 0 #c9c0ff, 0 18px 30px rgba(34,38,110,.08);
        }

        .payroll-config-step:nth-child(4) {
          background: #eaf8f4;
          box-shadow: 6px 8px 0 #aee6d9, 0 18px 30px rgba(34,38,110,.08);
        }

        .payroll-config-step:nth-child(5) {
          background: #fff0f2;
          box-shadow: 6px 8px 0 #f2c2cc, 0 18px 30px rgba(34,38,110,.08);
        }

        .payroll-config-step > span:last-child {
          display: grid;
          gap: 5px;
          min-width: 0;
        }

        .payroll-config-step strong {
          color: var(--pc-ink);
          font-size: 12px;
          line-height: 1.35;
          overflow-wrap: anywhere;
        }

        .payroll-config-step small {
          color: var(--pc-copy);
          font-size: 10px;
          line-height: 1.5;
          overflow-wrap: anywhere;
        }

        .payroll-config-step-number {
          display: grid;
          width: 32px;
          height: 32px;
          flex: 0 0 32px;
          place-items: center;
          border: 1px solid rgba(102,88,220,.16);
          border-radius: 10px;
          color: #40348d;
          background: rgba(255,255,255,.90);
          box-shadow: 2px 3px 0 rgba(52,43,120,.07);
          font-weight: 900;
        }

        .payroll-config-step.status-done,
        .payroll-config-step.status-ready {
          border-color: rgba(52,201,196,.34);
        }

        .payroll-config-step.status-done .payroll-config-step-number,
        .payroll-config-step.status-ready .payroll-config-step-number {
          color: #16744b;
          background: #eaf8f4;
        }

        .payroll-config-step.status-current {
          border-color: rgba(102,88,220,.38);
        }

        .payroll-config-step.status-blocked {
          opacity: .62;
        }

        .payroll-config-step:disabled,
        .payroll-config-page button:disabled {
          cursor: not-allowed;
        }

        .payroll-config-page button:disabled {
          opacity: .55;
        }

        .payroll-config-issues,
        .payroll-config-inline-issues,
        .payroll-config-ready-message,
        .payroll-config-info-notice,
        .payroll-config-notice {
          border-radius: 18px;
        }

        .payroll-config-issues {
          display: grid;
          gap: 12px;
          padding: 16px;
          border: 1px solid rgba(216,77,104,.18);
          background: #fff7e6;
          box-shadow: 4px 5px 0 rgba(255,224,165,.65);
        }

        .payroll-config-issues-title {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          color: #735500;
        }

        .payroll-config-issues-title > div {
          display: grid;
          gap: 3px;
          min-width: 0;
        }

        .payroll-config-issues-title span {
          color: #806a31;
          font-size: 11px;
        }

        .payroll-config-issue-list {
          display: grid;
          gap: 9px;
        }

        .payroll-config-issue-list article {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 12px 13px;
          border: 1px solid rgba(171,181,211,.42);
          border-radius: 15px;
          background: rgba(255,255,255,.90);
        }

        .payroll-config-issue-list article > div {
          min-width: 0;
        }

        .payroll-config-issue-list article strong {
          display: block;
          color: #674d00;
          font-size: 12px;
        }

        .payroll-config-issue-list article p {
          margin: 4px 0 0;
          color: #6d6250;
          font-size: 11px;
          line-height: 1.5;
        }

        .payroll-config-ready-message {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 14px 16px;
          border: 1px solid rgba(40,90,74,.18);
          color: #25633b;
          background: #eaf8f4;
          box-shadow: 4px 5px 0 rgba(174,230,217,.65);
          font-size: 12px;
          font-weight: 800;
        }

        .payroll-config-ready-message span {
          flex: 1;
          min-width: 0;
        }

        .payroll-config-inline-issues {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 14px 16px;
          border: 1px solid rgba(216,77,104,.18);
          color: #725600;
          background: #fff7e6;
        }

        .payroll-config-inline-issues > div {
          min-width: 0;
        }

        .payroll-config-inline-issues ul {
          margin: 7px 0 0;
          padding-left: 18px;
          color: #6c6250;
          font-size: 11px;
          line-height: 1.58;
        }

        .payroll-config-tabs {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          width: 100%;
          min-width: 0;
          padding: 8px;
          border: 1px solid rgba(171,181,211,.54);
          border-radius: 20px;
          background: rgba(255,255,255,.86);
          box-shadow: 4px 5px 0 rgba(52,43,120,.07);
        }

        .payroll-config-tabs button {
          display: flex;
          min-width: 0;
          min-height: 50px;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 10px 14px;
          border: 0;
          border-radius: 14px;
          color: #5d6785;
          background: transparent;
          font: inherit;
          font-size: 11px;
          font-weight: 900;
          cursor: pointer;
          transition: transform 180ms ease, background 180ms ease, color 180ms ease, box-shadow 180ms ease;
        }

        .payroll-config-tabs button.active {
          color: #fff;
          background: linear-gradient(135deg, #342b78, #5669d9);
          box-shadow: 3px 4px 0 rgba(185,215,255,.78);
        }

        .payroll-config-layout {
          display: grid;
          grid-template-columns: minmax(280px, 330px) minmax(0, 1fr);
          gap: 22px;
          align-items: start;
        }

        .payroll-config-sidebar {
  position: relative;
  align-self: start;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 14px;
  width: 100%;
  min-width: 0;
  height: fit-content;
  max-height: calc(100dvh - 36px);
  overflow: visible;
}

        .payroll-config-layout {
          position: relative;
        }

        .payroll-config-sidebar.is-sticky-fixed {
          position: fixed;
          z-index: 30;
          top: 18px;
          left: var(--payroll-sidebar-left);
          width: var(--payroll-sidebar-width);
          height: var(--payroll-sidebar-height);
          max-height: calc(100vh - 36px);
        }

        .payroll-config-sidebar.is-sticky-bottom {
          position: absolute;
          z-index: 30;
          top: auto;
          bottom: 0;
          left: 0;
          width: var(--payroll-sidebar-width);
          height: var(--payroll-sidebar-height);
          max-height: calc(100vh - 36px);
        }

        .payroll-config-main {
          display: grid;
          gap: 22px;
          min-width: 0;
        }

        .payroll-config-layout > .payroll-config-main {
          grid-column: 2;
        }

        .payroll-config-statutory-main {
          display: grid;
          gap: 22px;
          width: 100%;
          min-width: 0;
        }

        .payroll-config-search {
          display: flex;
          align-items: center;
          gap: 9px;
          min-height: 47px;
          padding: 0 13px;
          border: 1px solid rgba(151,161,197,.58);
          border-radius: 15px;
          color: #8290b1;
          background: rgba(255,255,255,.94);
          transition: border-color 170ms ease, box-shadow 170ms ease, transform 170ms ease;
        }

        .payroll-config-search:focus-within {
          border-color: rgba(102,88,220,.65);
          box-shadow: 4px 5px 0 rgba(102,88,220,.14), 0 0 0 4px rgba(102,88,220,.08);
          transform: translateY(-1px);
        }

        .payroll-config-search input {
          width: 100%;
          min-width: 0;
          min-height: 45px;
          padding: 0 !important;
          border: 0 !important;
          outline: 0 !important;
          background: transparent !important;
          box-shadow: none !important;
        }

        .payroll-config-employee-list {
  display: grid;
  gap: 9px;
  min-height: 0;
  max-height: calc(100dvh - 210px);
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  -webkit-overflow-scrolling: touch;
  padding-right: 3px;
}

        .payroll-config-employee-list button {
          display: grid;
          gap: 4px;
          min-width: 0;
          padding: 12px 13px;
          border: 1px solid rgba(171,181,211,.45);
          border-radius: 15px;
          color: var(--pc-ink);
          background: rgba(255,255,255,.82);
          box-shadow: 3px 4px 0 rgba(52,43,120,.06);
          text-align: left;
          cursor: pointer;
          transition: transform 170ms ease, border-color 170ms ease, background 170ms ease, box-shadow 170ms ease;
        }

        .payroll-config-employee-list button strong,
        .payroll-config-employee-list button span {
          min-width: 0;
          overflow-wrap: anywhere;
        }

        .payroll-config-employee-list button span {
          color: var(--pc-copy);
          font-size: 11px;
          line-height: 1.45;
        }

        .payroll-config-employee-list button.active {
          border-color: rgba(102,88,220,.36);
          color: #40348d;
          background: linear-gradient(145deg, #f1efff, #eef9ff);
          box-shadow: 4px 5px 0 #c9c0ff;
        }

        .payroll-config-placeholder {
          display: grid;
          min-height: 320px;
          place-items: center;
          align-content: center;
          color: var(--pc-copy);
          text-align: center;
        }

        .payroll-config-placeholder h2 {
          margin: 12px 0 4px;
          color: var(--pc-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(24px, 2.2vw, 34px);
        }

        .payroll-config-placeholder p {
          margin: 0;
          line-height: 1.6;
        }

        .payroll-config-form-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }

        .payroll-config-form-grid-3 {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }

        .payroll-config-page label {
          display: grid;
          gap: 8px;
          min-width: 0;
          color: #303b5b;
          font-size: 11px;
          font-weight: 900;
        }

        .payroll-config-page input,
        .payroll-config-page select,
        .payroll-config-page textarea {
          width: 100%;
          min-width: 0;
          min-height: 47px;
          padding: 0 13px;
          border: 1px solid rgba(151,161,197,.58);
          border-radius: 15px;
          outline: 0;
          color: var(--pc-ink);
          background: rgba(255,255,255,.94);
          font: inherit;
          font-weight: 650;
          transition: border-color 170ms ease, box-shadow 170ms ease, transform 170ms ease;
        }

        .payroll-config-page textarea {
          min-height: 110px;
          padding: 13px;
          resize: vertical;
        }

        .payroll-config-page input:focus,
        .payroll-config-page select:focus,
        .payroll-config-page textarea:focus {
          border-color: rgba(102,88,220,.65);
          box-shadow: 4px 5px 0 rgba(102,88,220,.14), 0 0 0 4px rgba(102,88,220,.08);
          transform: translateY(-1px);
        }

        .payroll-config-page input:disabled,
        .payroll-config-page select:disabled,
        .payroll-config-page textarea:disabled {
          background: #f4f6fa;
          color: #667085;
        }

        .payroll-component-list {
          display: grid;
          gap: 12px;
        }

        .payroll-component-row {
          overflow: hidden;
          border: 1px solid rgba(171,181,211,.58);
          border-radius: 19px;
          background: rgba(255,255,255,.82);
          box-shadow: 4px 5px 0 rgba(52,43,120,.06);
          transition: transform 190ms ease, box-shadow 190ms ease, border-color 190ms ease;
        }

        .payroll-component-summary {
          display: grid;
          grid-template-columns: 36px minmax(150px, 1fr) minmax(130px, auto) 22px;
          gap: 11px;
          align-items: center;
          width: 100%;
          min-width: 0;
          padding: 14px;
          border: 0;
          color: var(--pc-ink);
          background: linear-gradient(145deg, #edf6ff, #f1efff);
          text-align: left;
          cursor: pointer;
        }

        .payroll-component-summary > span:nth-child(2) {
          display: grid;
          gap: 3px;
          min-width: 0;
        }

        .payroll-component-summary strong,
        .payroll-component-summary small,
        .payroll-component-summary-value {
          overflow-wrap: anywhere;
        }

        .payroll-component-summary small {
          color: var(--pc-copy);
          font-size: 10px;
        }

        .payroll-component-number {
          display: grid;
          width: 32px;
          height: 32px;
          place-items: center;
          border: 1px solid rgba(102,88,220,.18);
          border-radius: 10px;
          color: #40348d;
          background: #fff;
          box-shadow: 2px 3px 0 rgba(52,43,120,.08);
          font-weight: 900;
        }

        .payroll-component-summary-value {
          color: #53617f;
          font-size: 11px;
          font-weight: 850;
        }

        .payroll-component-editor {
          display: grid;
          gap: 16px;
          padding: 18px;
          border-top: 1px solid rgba(171,181,211,.45);
          background: #fff;
        }

        .payroll-config-check-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 9px;
        }

        .payroll-config-check,
        .payroll-switch {
          display: inline-flex !important;
          grid-template-columns: none !important;
          align-items: center;
          gap: 8px !important;
          min-width: 0;
          padding: 9px 11px;
          border: 1px solid rgba(102,88,220,.22);
          border-radius: 14px;
          color: #40348d !important;
          background: linear-gradient(145deg, #f1efff, #eef9ff);
          box-shadow: 3px 4px 0 rgba(52,43,120,.07);
        }

        .payroll-config-check input,
        .payroll-switch input,
        .payroll-pt-table input[type="checkbox"] {
          width: 18px;
          min-width: 18px;
          min-height: 18px;
          height: 18px;
          padding: 0;
          box-shadow: none;
          accent-color: #6658dc;
        }

        .payroll-component-actions,
        .payroll-config-actions,
        .payroll-config-rule-actions,
        .payroll-config-history-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 9px;
          flex-wrap: wrap;
        }

        .payroll-config-actions {
          margin-top: 16px;
        }

        .payroll-config-page .primary {
          border: 0;
          color: #fff;
          background: linear-gradient(135deg, #342b78, #4f65d7 58%, #18b5c8);
          box-shadow: 5px 6px 0 #a9d6f5, 0 14px 25px rgba(36,74,128,.16);
        }

        .payroll-config-page .secondary {
          border: 1px solid rgba(65,55,161,.18);
          color: #40348d;
          background: rgba(255,255,255,.94);
          box-shadow: 3px 4px 0 rgba(52,43,120,.09);
        }

        .payroll-config-page .success-button {
          border: 0;
          color: #fff;
          background: linear-gradient(135deg, #16744b, #34a777);
          box-shadow: 4px 5px 0 #aee6d9, 0 12px 22px rgba(22,116,75,.14);
        }

        .payroll-config-page .danger-light {
          border: 1px solid rgba(216,77,104,.24);
          color: #b4234f;
          background: #fff0f2;
          box-shadow: 3px 4px 0 #f2c2cc;
        }

        .payroll-config-page .icon-button {
          width: 42px;
          min-width: 42px;
          padding: 0;
          border: 1px solid rgba(102,88,220,.18);
          color: var(--pc-violet);
          background: rgba(255,255,255,.94);
          box-shadow: 2px 3px 0 rgba(52,43,120,.08);
        }

        .danger-icon {
          color: #b4234f !important;
        }

        .payroll-config-history {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 14px;
        }

        .payroll-config-history article {
          min-width: 0;
          padding: 16px;
          border: 1px solid rgba(171,181,211,.58);
          border-radius: 20px;
          background: linear-gradient(145deg, #ffffff, #f7fbff);
          box-shadow: 5px 6px 0 rgba(185,215,255,.65);
          transition: transform 180ms ease, box-shadow 180ms ease;
        }

        .payroll-config-history article:nth-child(3n + 2) {
          box-shadow: 5px 6px 0 rgba(201,192,255,.65);
        }

        .payroll-config-history article:nth-child(3n + 3) {
          box-shadow: 5px 6px 0 rgba(174,230,217,.72);
        }

        .payroll-config-history article > div:first-child {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 9px;
          min-width: 0;
        }

        .payroll-config-history article strong,
        .payroll-config-history article p {
          overflow-wrap: anywhere;
        }

        .payroll-config-history p {
          margin: 8px 0 0;
          color: var(--pc-copy);
          font-size: 11px;
          line-height: 1.5;
        }

        .payroll-config-rule-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 22px;
        }

        .payroll-config-rule-card {
          min-width: 0;
        }

        .payroll-config-rule-head > div {
          display: flex;
          align-items: center;
          gap: 9px;
          min-width: 0;
        }

        .payroll-config-info-notice {
          display: flex;
          align-items: flex-start;
          gap: 9px;
          margin: 0 0 14px;
          padding: 12px 14px;
          border: 1px solid rgba(5,150,105,.18);
          color: #046c4e;
          background: #eaf8f4;
          font-size: 11px;
          font-weight: 760;
          line-height: 1.55;
        }

        .payroll-config-span-2 {
          grid-column: 1 / -1;
        }

        .payroll-config-notice {
          display: flex;
          align-items: flex-start;
          gap: 9px;
          margin-top: 14px;
          padding: 12px 14px;
          border: 1px solid rgba(138,90,23,.17);
          color: #745500;
          background: #fff4d5;
          font-size: 11px;
          font-weight: 760;
          line-height: 1.55;
        }

        .payroll-pt-table-wrap {
          overflow-x: auto;
          margin-top: 14px;
          border: 1px solid rgba(171,181,211,.50);
          border-radius: 18px;
          background: #fff;
        }

        .payroll-pt-table {
          width: 100%;
          min-width: 850px;
          border-collapse: collapse;
        }

        .payroll-pt-table th,
        .payroll-pt-table td {
          padding: 10px;
          border-bottom: 1px solid rgba(171,181,211,.38);
          text-align: left;
          font-size: 11px;
        }

        .payroll-pt-table th {
          color: #5d6785;
          background: linear-gradient(145deg, #edf6ff, #f1efff);
          font-weight: 900;
          letter-spacing: .03em;
        }

        .payroll-pt-table tbody tr:last-child td {
          border-bottom: 0;
        }

        .payroll-pt-table td:nth-child(4),
        .payroll-pt-table td:nth-child(5) {
          text-align: center;
        }

        .payroll-config-empty,
        .payroll-config-loading {
          padding: 22px;
          color: var(--pc-copy);
          font-size: 12px;
          text-align: center;
        }

        .payroll-config-loading {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }

        .spin {
          animation: payroll-config-spin .8s linear infinite;
        }

        @keyframes payroll-config-spin {
          to { transform: rotate(360deg); }
        }

        @media (max-width: 1280px) {
          .payroll-config-step-map {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .payroll-config-layout {
            grid-template-columns: minmax(250px, 300px) minmax(0, 1fr);
          }

          .payroll-config-form-grid-3 {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 1050px) {
          .payroll-config-hero {
            grid-template-columns: 1fr;
          }

          .payroll-config-hero-actions {
            justify-content: flex-start;
          }

          .payroll-config-layout,
          .payroll-config-rule-grid {
            grid-template-columns: 1fr;
          }

          .payroll-config-layout > .payroll-config-main {
            grid-column: 1;
          }

          .payroll-config-sidebar,
          .payroll-config-sidebar.is-sticky-fixed,
          .payroll-config-sidebar.is-sticky-bottom {
            position: static;
            top: auto;
            right: auto;
            bottom: auto;
            left: auto;
            width: 100%;
            height: auto;
            max-height: none;
            overflow: visible;
          }

          .payroll-config-employee-list {
            max-height: 320px;
          }

          .payroll-config-step-map {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }


        @media (pointer: coarse) {
  .payroll-config-sidebar,
  .payroll-config-sidebar.is-sticky-fixed,
  .payroll-config-sidebar.is-sticky-bottom {
    position: static;
    top: auto;
    right: auto;
    bottom: auto;
    left: auto;
    width: 100%;
    height: auto;
    max-height: none;
    overflow: visible;
  }

  .payroll-config-employee-list {
    max-height: 320px;
    overflow-y: auto;
    overscroll-behavior-y: contain;
    -webkit-overflow-scrolling: touch;
  }
}

        @media (max-width: 820px) {
          .payroll-config-page {
            gap: 18px;
          }

          .payroll-config-hero {
            min-height: 0;
            padding: 26px;
          }

          .payroll-config-hero h1 {
            font-size: clamp(38px, 8vw, 58px);
          }

          .payroll-config-hero-actions {
            width: 100%;
          }

          .payroll-config-tax-button {
            width: min(100%, 360px);
          }

          .payroll-config-hero-icon {
            display: none;
          }

          .payroll-config-form-grid,
          .payroll-config-form-grid-3 {
            grid-template-columns: 1fr;
          }

          .payroll-config-section-head,
          .payroll-config-rule-head {
            align-items: stretch;
            flex-direction: column;
          }

          .payroll-config-section-head > svg {
            margin-left: 0;
          }

          .payroll-config-rule-actions,
          .payroll-config-actions,
          .payroll-component-actions,
          .payroll-config-history-actions {
            justify-content: flex-start;
          }

          .payroll-config-rule-actions > *,
          .payroll-config-actions > * {
            flex: 1 1 auto;
          }
        }

        @media (max-width: 680px) {
          .payroll-config-page {
            gap: 15px;
          }

          .payroll-config-hero {
            padding: 22px 18px;
            border-radius: 26px;
            box-shadow:
              7px 9px 0 #c6d8f7,
              0 20px 34px rgba(34,38,110,.11);
          }

          .payroll-config-hero h1 {
            font-size: clamp(34px, 12vw, 50px);
          }

          .payroll-config-hero p {
            font-size: 12px;
          }

          .payroll-config-card {
            padding: 17px;
            border-radius: 22px;
            box-shadow:
              5px 7px 0 #c4ccff,
              0 18px 30px rgba(34,38,110,.09);
          }

          .payroll-config-tabs {
            gap: 8px;
            padding: 6px;
          }

          .payroll-config-tabs button {
            min-height: 46px;
            padding: 9px 10px;
            font-size: 10px;
          }

          .payroll-config-step-map {
            grid-template-columns: 1fr;
          }

          .payroll-config-step {
            min-height: 0;
          }

          .payroll-config-issue-list article,
          .payroll-config-ready-message {
            align-items: stretch;
            flex-direction: column;
          }

          .payroll-config-ready-message .success-button,
          .payroll-config-issue-list .secondary {
            width: 100%;
          }

          .payroll-component-summary {
            grid-template-columns: 34px minmax(0, 1fr) 20px;
          }

          .payroll-component-summary-value {
            display: none;
          }

          .payroll-config-tenant-card,
          .payroll-config-state-loader,
          .payroll-config-inline-field {
            align-items: stretch;
            flex-direction: column;
          }

          .payroll-config-tenant-card label,
          .payroll-config-state-loader label,
          .payroll-config-inline-field label {
            flex: 1 1 auto;
            width: 100%;
          }

          .payroll-config-history {
            grid-template-columns: 1fr;
          }

          .payroll-config-history article > div:first-child {
            align-items: flex-start;
            flex-direction: column;
          }

          .payroll-config-status {
            white-space: normal;
          }
        }

        @media (max-width: 520px) {
          .payroll-config-hero {
            padding: 20px 15px;
          }

          .payroll-config-hero h1 {
            font-size: clamp(31px, 11vw, 43px);
          }

          .payroll-config-eyebrow,
          .payroll-config-kicker {
            max-width: 100%;
            white-space: normal;
          }

          .payroll-config-tax-button,
          .payroll-config-page .primary,
          .payroll-config-page .secondary,
          .payroll-config-page .success-button,
          .payroll-config-page .danger-light {
            width: 100%;
          }

          .payroll-config-tabs {
            grid-template-columns: 1fr;
          }

          .payroll-config-card {
            padding: 15px;
            border-radius: 19px;
          }

          .payroll-config-section-head h2,
          .payroll-config-rule-head h2,
          .payroll-config-rule-card > h2 {
            font-size: 25px;
          }

          .payroll-config-check-grid {
            display: grid;
            grid-template-columns: 1fr;
          }

          .payroll-config-check,
          .payroll-switch {
            width: 100%;
          }

          .payroll-config-rule-actions,
          .payroll-config-actions,
          .payroll-component-actions,
          .payroll-config-history-actions {
            display: grid;
            grid-template-columns: 1fr;
            width: 100%;
          }

          .payroll-pt-table-wrap {
            margin-inline: -4px;
          }
        }

        @media (max-width: 380px) {
          .payroll-config-page {
            gap: 13px;
          }

          .payroll-config-hero {
            padding: 18px 13px;
          }

          .payroll-config-card {
            padding: 13px;
          }

          .payroll-config-step,
          .payroll-component-editor {
            padding: 13px;
          }
        }
      `}</style>
    </section>
  );
}