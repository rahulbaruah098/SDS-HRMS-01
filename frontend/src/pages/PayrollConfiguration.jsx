import { useEffect, useMemo, useState } from 'react';
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
const REQUIRED_EARNING_CODES = new Set([
  'basic',
  'hra',
  'medical_allowance',
  'other_allowances',
]);

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

function statusLabel(value) {
  return safeText(value, 'draft')
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function documentId(document = {}) {
  return safeText(document._id || document.id);
}

function defaultSalaryComponents() {
  return [
    {
      code: 'basic',
      label: 'Basic',
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
    {
      code: 'hra',
      label: 'HRA',
      category: 'earning',
      calculation_type: 'fixed',
      amount: '',
      percentage: '',
      base_component: 'basic',
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
    {
      code: 'medical_allowance',
      label: 'Medical Allowance',
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
    {
      code: 'other_allowances',
      label: 'Other Allowances',
      category: 'earning',
      calculation_type: 'balancing',
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
  ];
}

function emptySalaryForm() {
  return {
    id: '',
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
  return {
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
  };
}

function salaryFormFromDocument(document = {}) {
  return {
    id: documentId(document),
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
    state_code: safeText(stateCode, 'ALL').toUpperCase(),
    state_name: '',
    effective_from: todayInputValue(),
    effective_to: '',
    rounding_mode: 'nearest_rupee',
    source_reference: '',
    notes: '',
    pf: {
      enabled: false,
      employee_rate_percent: '',
      employer_rate_percent: '',
      wage_ceiling: '',
      wage_base_component_codes: 'basic',
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
      mode: 'manual',
      source: '',
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
    state_code: safeText(document.state_code, 'ALL'),
    state_name: safeText(document.state_name),
    effective_from: dateInputValue(document.effective_from),
    effective_to: dateInputValue(document.effective_to),
    rounding_mode: safeText(document.rounding_mode, 'nearest_rupee'),
    source_reference: safeText(document.source_reference),
    notes: safeText(document.notes),
    pf: {
      enabled: pf.enabled === true,
      employee_rate_percent: pf.employee_rate_percent ?? '',
      employer_rate_percent: pf.employer_rate_percent ?? '',
      wage_ceiling: pf.wage_ceiling ?? '',
      wage_base_component_codes: Array.isArray(pf.wage_base_component_codes)
        ? pf.wage_base_component_codes.join(',')
        : safeText(pf.wage_base_component_codes, 'basic'),
      allow_higher_wage_contribution: pf.allow_higher_wage_contribution === true,
      employee_higher_wage_enabled: pf.employee_higher_wage_enabled === true,
      employer_higher_wage_enabled: pf.employer_higher_wage_enabled === true,
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
      mode: safeText(tds.mode, 'manual'),
      source: safeText(tds.source),
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

export default function PayrollConfiguration({ user = {} }) {
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
  const [expandedComponent, setExpandedComponent] = useState(0);

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
          state_code: safeText(
            employee?.state_code || employee?.work_state_code || employee?.payroll_state_code,
            'ALL',
          ).toUpperCase(),
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

  useEffect(() => {
    if (!superAdmin || tenantId.trim()) {
      loadEmployees({ silent: true });
    }
    // Initial tenant load only. Superadmin can use the explicit load button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedEmployeeId) {
      loadSalaryHistory(selectedEmployeeId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmployeeId]);

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
      components: current.components.map((component, componentIndex) =>
        componentIndex === index ? { ...component, [field]: value } : component,
      ),
    }));
  }

  function addComponent() {
    setSalaryForm((current) => ({
      ...current,
      components: [
        ...current.components,
        {
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
    }));
    setExpandedComponent(salaryForm.components.length);
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
      ...(salaryForm.id ? { _id: salaryForm.id } : {}),
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
      components: salaryForm.components.map((component, index) => ({
        code: normalizeKey(component.code),
        label: component.label,
        category: component.category,
        calculation_type: component.calculation_type,
        amount: numberOrBlank(component.amount),
        percentage: numberOrBlank(component.percentage),
        base_component: normalizeKey(component.base_component),
        balance_of: normalizeKey(component.balance_of),
        minimum_amount: numberOrBlank(component.minimum_amount || 0),
        statutory_rule: normalizeKey(component.statutory_rule),
        prorate_on_lwp: component.prorate_on_lwp,
        include_in_gross: component.include_in_gross,
        include_in_ctc: component.include_in_ctc,
        show_in_earnings: component.show_in_earnings,
        show_in_deductions: component.show_in_deductions,
        taxable: component.taxable,
        is_active: component.is_active,
        display_order: index + 1,
      })),
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

    if (!id) {
      alerts.warning('Save the salary structure as a draft first.', 'Draft Required');
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

  function startSalaryRevision(source = salaryForm) {
    const sourceDocument = source.components ? source : salaryFormFromDocument(source);

    setSalaryForm({
      ...sourceDocument,
      id: '',
      effective_from: todayInputValue(),
      effective_to: '',
      notes: '',
    });
    setExpandedComponent(0);
  }

  function updateStatutorySection(section, field, value) {
    setStatutoryForm((current) => ({
      ...current,
      [section]: {
        ...current[section],
        [field]: value,
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

  function statutoryPayload() {
    return {
      ...(statutoryForm.id ? { _id: statutoryForm.id } : {}),
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
        employee_rate_percent: numberOrBlank(statutoryForm.pf.employee_rate_percent),
        employer_rate_percent: numberOrBlank(statutoryForm.pf.employer_rate_percent),
        wage_ceiling: numberOrBlank(statutoryForm.pf.wage_ceiling),
        wage_base_component_codes: listFromCommaText(
          statutoryForm.pf.wage_base_component_codes,
        ),
      },
      professional_tax: {
        enabled: statutoryForm.professional_tax.enabled,
        basis: normalizeKey(statutoryForm.professional_tax.basis),
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
        mode: statutoryForm.tds.mode,
        source: statutoryForm.tds.source,
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

    if (!id) {
      alerts.warning('Save the statutory configuration as a draft first.', 'Draft Required');
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
      alerts.success('Statutory revision activated.', 'Revision Activated');
    } catch (error) {
      alerts.error(error.message || 'Unable to activate statutory revision.', 'Activation Failed');
    } finally {
      setSavingStatutory(false);
    }
  }

  function startStatutoryRevision(source = statutoryForm) {
    const sourceDocument = source.pf ? source : statutoryFormFromDocument(source);

    setStatutoryForm({
      ...sourceDocument,
      id: '',
      effective_from: todayInputValue(),
      effective_to: '',
      notes: '',
    });
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
            Configure employee salary revisions and effective-dated statutory rules.
            Percentages and slabs remain company/state controlled instead of being fixed in code.
          </p>
        </div>

        <div className="payroll-config-hero-icon">
          <BadgeIndianRupee size={34} />
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
          <aside className="payroll-config-card payroll-config-sidebar">
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
                    onClick={() => setSelectedEmployeeId(id)}
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

          <main className="payroll-config-main">
            {!selectedEmployeeId ? (
              <section className="payroll-config-card payroll-config-placeholder">
                <Users size={34} />
                <h2>Select an employee</h2>
                <p>Choose an employee to create or revise their salary structure.</p>
              </section>
            ) : (
              <>
                <section className="payroll-config-card">
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

                <section className="payroll-config-card">
                  <div className="payroll-config-section-head">
                    <div>
                      <span className="payroll-config-kicker">Dynamic breakup</span>
                      <h2>Salary components</h2>
                      <p>No percentage is assumed. Enter fixed values or define percentage bases explicitly.</p>
                    </div>
                    <button type="button" className="secondary" onClick={addComponent}>
                      <Plus size={16} /> Add Component
                    </button>
                  </div>

                  <div className="payroll-component-list">
                    {salaryForm.components.map((component, index) => {
                      const expanded = expandedComponent === index;
                      return (
                        <article className="payroll-component-row" key={`${component.code}-${index}`}>
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
                                    disabled={REQUIRED_EARNING_CODES.has(normalizeKey(component.code))}
                                    onChange={(event) => updateComponent(index, 'code', event.target.value)}
                                    placeholder="component_code"
                                  />
                                </label>
                                <label>
                                  Display label
                                  <input
                                    value={component.label}
                                    onChange={(event) => updateComponent(index, 'label', event.target.value)}
                                  />
                                </label>
                                <label>
                                  Category
                                  <select
                                    value={component.category}
                                    onChange={(event) => updateComponent(index, 'category', event.target.value)}
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
                                      />
                                    </label>
                                    <label>
                                      Percentage base
                                      <input
                                        value={component.base_component}
                                        onChange={(event) =>
                                          updateComponent(index, 'base_component', event.target.value)
                                        }
                                        placeholder="basic or monthly_ctc"
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
                                    />
                                    {label}
                                  </label>
                                ))}
                              </div>

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

                <section className="payroll-config-card">
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
                    <button type="button" className="primary" onClick={saveSalaryDraft} disabled={savingSalary}>
                      {savingSalary ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
                      Save Draft
                    </button>
                    <button
                      type="button"
                      className="success-button"
                      disabled={!salaryForm.id || savingSalary}
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
                            <button type="button" className="secondary" onClick={() => setSalaryForm(salaryFormFromDocument(item))}>
                              Edit Draft
                            </button>
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
        <div className="payroll-config-main payroll-config-statutory-main">
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
                  <input type="number" min="0" max="100" step="0.0001" value={statutoryForm.pf.employee_rate_percent} onChange={(event) => updateStatutorySection('pf', 'employee_rate_percent', event.target.value)} />
                </label>
                <label>
                  Employer rate (%)
                  <input type="number" min="0" max="100" step="0.0001" value={statutoryForm.pf.employer_rate_percent} onChange={(event) => updateStatutorySection('pf', 'employer_rate_percent', event.target.value)} />
                </label>
                <label>
                  Wage ceiling
                  <input type="number" min="0" step="0.01" value={statutoryForm.pf.wage_ceiling} onChange={(event) => updateStatutorySection('pf', 'wage_ceiling', event.target.value)} />
                </label>
                <label>
                  Wage-base component codes
                  <input value={statutoryForm.pf.wage_base_component_codes} onChange={(event) => updateStatutorySection('pf', 'wage_base_component_codes', event.target.value)} placeholder="basic,dearness_allowance" />
                </label>
              </div>

              <div className="payroll-config-check-grid">
                {[
                  ['allow_higher_wage_contribution', 'Allow higher-wage contribution'],
                  ['employee_higher_wage_enabled', 'Employee higher-wage enabled'],
                  ['employer_higher_wage_enabled', 'Employer higher-wage enabled'],
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
              <label className="payroll-switch">
                <input type="checkbox" checked={statutoryForm.professional_tax.enabled} onChange={(event) => updateStatutorySection('professional_tax', 'enabled', event.target.checked)} />
                <span>Enabled</span>
              </label>
            </div>

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
              <h2>TDS Handling</h2>
              <div className="payroll-config-form-grid">
                <label>
                  Mode
                  <select value={statutoryForm.tds.mode} onChange={(event) => updateStatutorySection('tds', 'mode', event.target.value)}>
                    <option value="manual">Manual Input</option>
                    <option value="external">External Calculation</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </label>
                <label>
                  Source / system
                  <input value={statutoryForm.tds.source} onChange={(event) => updateStatutorySection('tds', 'source', event.target.value)} placeholder="Optional" />
                </label>
              </div>
              <div className="payroll-config-notice">
                <AlertTriangle size={17} /> TDS is not estimated by this module until your company finalizes the calculation method.
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
            <label>
              Configuration notes
              <textarea rows="3" value={statutoryForm.notes} onChange={(event) => setStatutoryForm((current) => ({ ...current, notes: event.target.value }))} />
            </label>

            <div className="payroll-config-actions">
              <button type="button" className="primary" onClick={saveStatutoryDraft} disabled={savingStatutory}>
                {savingStatutory ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
                Save Draft
              </button>
              <button type="button" className="success-button" disabled={!statutoryForm.id || savingStatutory} onClick={() => activateStatutoryDraft()}>
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
                      <button type="button" className="secondary" onClick={() => setStatutoryForm(statutoryFormFromDocument(item))}>Edit Draft</button>
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
          display: grid;
          gap: 18px;
          color: var(--text, #172033);
        }

        .payroll-config-hero {
          display: flex;
          justify-content: space-between;
          gap: 24px;
          padding: 28px;
          border-radius: 26px;
          background: linear-gradient(135deg, #102a43, #1c4b6e);
          color: #fff;
          box-shadow: 0 18px 50px rgba(16, 42, 67, 0.2);
        }

        .payroll-config-hero h1 {
          margin: 8px 0 8px;
          font-size: clamp(25px, 3vw, 36px);
        }

        .payroll-config-hero p {
          max-width: 780px;
          margin: 0;
          color: rgba(255,255,255,.78);
          line-height: 1.6;
        }

        .payroll-config-eyebrow,
        .payroll-config-kicker {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          text-transform: uppercase;
          letter-spacing: .09em;
          font-size: 11px;
          font-weight: 900;
        }

        .payroll-config-hero-icon {
          width: 76px;
          height: 76px;
          display: grid;
          place-items: center;
          flex: 0 0 auto;
          border-radius: 24px;
          background: rgba(255,255,255,.13);
          border: 1px solid rgba(255,255,255,.2);
        }

        .payroll-config-card {
          padding: 20px;
          border: 1px solid var(--border, #e2e8f0);
          border-radius: 22px;
          background: var(--surface, #fff);
          box-shadow: 0 10px 30px rgba(15, 23, 42, .06);
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
        }

        .payroll-config-tabs {
          display: flex;
          gap: 8px;
          padding: 6px;
          width: fit-content;
          max-width: 100%;
          border: 1px solid var(--border, #e2e8f0);
          border-radius: 16px;
          background: var(--surface, #fff);
        }

        .payroll-config-tabs button {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 10px 14px;
          border: 0;
          border-radius: 11px;
          background: transparent;
          color: var(--muted, #64748b);
          font-weight: 850;
          cursor: pointer;
        }

        .payroll-config-tabs button.active {
          background: #e8f3fa;
          color: #164e72;
        }

        .payroll-config-layout {
          display: grid;
          grid-template-columns: minmax(250px, 310px) minmax(0, 1fr);
          gap: 18px;
          align-items: start;
        }

        .payroll-config-sidebar {
          position: sticky;
          top: 18px;
          display: grid;
          gap: 14px;
          max-height: calc(100vh - 36px);
        }

        .payroll-config-main {
          display: grid;
          gap: 18px;
          min-width: 0;
        }

        .payroll-config-statutory-main {
          width: 100%;
        }

        .payroll-config-section-head,
        .payroll-config-rule-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          margin-bottom: 16px;
        }

        .payroll-config-section-head h2,
        .payroll-config-rule-head h2,
        .payroll-config-rule-card > h2 {
          margin: 3px 0 0;
          font-size: 18px;
        }

        .payroll-config-section-head p {
          margin: 4px 0 0;
          color: var(--muted, #64748b);
          font-size: 13px;
        }

        .payroll-config-kicker {
          color: #2d6a8e;
        }

        .payroll-config-search {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 0 12px;
          border: 1px solid var(--border, #e2e8f0);
          border-radius: 12px;
        }

        .payroll-config-search input {
          min-width: 0;
          border: 0 !important;
          padding-left: 0 !important;
          box-shadow: none !important;
        }

        .payroll-config-employee-list {
          display: grid;
          gap: 7px;
          overflow: auto;
        }

        .payroll-config-employee-list button {
          display: grid;
          gap: 3px;
          text-align: left;
          padding: 11px 12px;
          border: 1px solid transparent;
          border-radius: 12px;
          background: #f8fafc;
          cursor: pointer;
        }

        .payroll-config-employee-list button span {
          color: var(--muted, #64748b);
          font-size: 12px;
        }

        .payroll-config-employee-list button.active {
          border-color: #7bb6d9;
          background: #eaf5fb;
          color: #164e72;
        }

        .payroll-config-placeholder {
          min-height: 300px;
          display: grid;
          place-items: center;
          align-content: center;
          text-align: center;
          color: var(--muted, #64748b);
        }

        .payroll-config-placeholder h2 {
          margin: 12px 0 4px;
          color: var(--text, #172033);
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
          gap: 7px;
          color: #34445c;
          font-size: 12px;
          font-weight: 850;
        }

        .payroll-config-page input,
        .payroll-config-page select,
        .payroll-config-page textarea {
          width: 100%;
          min-height: 42px;
          padding: 9px 11px;
          border: 1px solid var(--border, #dbe3ec);
          border-radius: 11px;
          background: var(--surface, #fff);
          color: var(--text, #172033);
          font: inherit;
          font-weight: 600;
          box-sizing: border-box;
        }

        .payroll-config-page textarea {
          resize: vertical;
        }

        .payroll-config-page input:focus,
        .payroll-config-page select:focus,
        .payroll-config-page textarea:focus {
          outline: none;
          border-color: #4b94bd;
          box-shadow: 0 0 0 3px rgba(75, 148, 189, .14);
        }

        .payroll-config-page button {
          font: inherit;
        }

        .payroll-component-list {
          display: grid;
          gap: 10px;
        }

        .payroll-component-row {
          border: 1px solid var(--border, #e2e8f0);
          border-radius: 15px;
          overflow: hidden;
        }

        .payroll-component-summary {
          width: 100%;
          display: grid;
          grid-template-columns: 34px minmax(150px, 1fr) minmax(150px, auto) 20px;
          align-items: center;
          gap: 10px;
          padding: 12px;
          border: 0;
          background: #fbfdff;
          color: var(--text, #172033);
          text-align: left;
          cursor: pointer;
        }

        .payroll-component-summary > span:nth-child(2) {
          display: grid;
          gap: 2px;
        }

        .payroll-component-summary small {
          color: var(--muted, #64748b);
        }

        .payroll-component-number {
          width: 30px;
          height: 30px;
          display: grid;
          place-items: center;
          border-radius: 9px;
          background: #eaf5fb;
          color: #164e72;
          font-weight: 900;
        }

        .payroll-component-summary-value {
          color: #475569;
          font-size: 12px;
          font-weight: 800;
        }

        .payroll-component-editor {
          display: grid;
          gap: 16px;
          padding: 16px;
          border-top: 1px solid var(--border, #e2e8f0);
          background: #fff;
        }

        .payroll-config-check-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .payroll-config-check,
        .payroll-switch {
          display: inline-flex !important;
          grid-template-columns: none !important;
          align-items: center;
          gap: 7px !important;
          padding: 7px 9px;
          border: 1px solid var(--border, #e2e8f0);
          border-radius: 10px;
          background: #f8fafc;
        }

        .payroll-config-check input,
        .payroll-switch input,
        .payroll-pt-table input[type="checkbox"] {
          width: 16px;
          min-height: 16px;
          height: 16px;
          padding: 0;
          box-shadow: none;
        }

        .payroll-component-actions {
          display: flex;
          justify-content: flex-end;
        }

        .payroll-config-actions {
          margin-top: 16px;
        }

        .payroll-config-page .primary,
        .payroll-config-page .secondary,
        .payroll-config-page .success-button,
        .payroll-config-page .danger-light,
        .payroll-config-page .icon-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          min-height: 40px;
          padding: 9px 13px;
          border-radius: 11px;
          cursor: pointer;
          font-weight: 850;
        }

        .payroll-config-page .primary {
          border: 1px solid #164e72;
          background: #164e72;
          color: #fff;
        }

        .payroll-config-page .secondary {
          border: 1px solid var(--border, #dbe3ec);
          background: #fff;
          color: #29445f;
        }

        .payroll-config-page .success-button {
          border: 1px solid #16744b;
          background: #16744b;
          color: #fff;
        }

        .payroll-config-page .danger-light {
          border: 1px solid #fecaca;
          background: #fff1f2;
          color: #b42318;
        }

        .payroll-config-page .icon-button {
          width: 40px;
          padding: 0;
          border: 1px solid var(--border, #dbe3ec);
          background: #fff;
          color: #475569;
        }

        .payroll-config-page button:disabled {
          opacity: .55;
          cursor: not-allowed;
        }

        .danger-icon {
          color: #b42318 !important;
        }

        .payroll-config-history {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
          gap: 12px;
        }

        .payroll-config-history article {
          padding: 14px;
          border: 1px solid var(--border, #e2e8f0);
          border-radius: 14px;
          background: #fbfdff;
        }

        .payroll-config-history article > div:first-child {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          align-items: center;
        }

        .payroll-config-history p {
          margin: 7px 0 0;
          color: var(--muted, #64748b);
          font-size: 12px;
        }

        .payroll-config-history-actions {
          margin-top: 12px;
        }

        .payroll-config-status {
          padding: 4px 7px;
          border-radius: 999px;
          font-size: 10px;
          font-weight: 900;
          background: #fff3cd;
          color: #795400;
        }

        .status-active {
          background: #dcfce7;
          color: #166534;
        }

        .status-superseded,
        .status-archived {
          background: #e2e8f0;
          color: #475569;
        }

        .payroll-config-rule-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 18px;
        }

        .payroll-config-rule-card {
          min-width: 0;
        }

        .payroll-config-rule-head > div {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .payroll-config-span-2 {
          grid-column: 1 / -1;
        }

        .payroll-config-notice {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          margin-top: 14px;
          padding: 11px;
          border-radius: 11px;
          background: #fff8e6;
          color: #745500;
          font-size: 12px;
          font-weight: 750;
        }

        .payroll-pt-table-wrap {
          overflow-x: auto;
          margin-top: 14px;
        }

        .payroll-pt-table {
          width: 100%;
          min-width: 850px;
          border-collapse: collapse;
        }

        .payroll-pt-table th,
        .payroll-pt-table td {
          padding: 8px;
          border-bottom: 1px solid var(--border, #e2e8f0);
          text-align: left;
          font-size: 12px;
        }

        .payroll-pt-table th {
          color: #475569;
          background: #f8fafc;
        }

        .payroll-pt-table td:nth-child(4),
        .payroll-pt-table td:nth-child(5) {
          text-align: center;
        }

        .payroll-config-empty,
        .payroll-config-loading {
          padding: 22px;
          text-align: center;
          color: var(--muted, #64748b);
          font-size: 13px;
        }

        .payroll-config-loading {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }

        @media (max-width: 1050px) {
          .payroll-config-layout,
          .payroll-config-rule-grid {
            grid-template-columns: 1fr;
          }

          .payroll-config-sidebar {
            position: static;
            max-height: none;
          }

          .payroll-config-employee-list {
            max-height: 320px;
          }

          .payroll-config-form-grid-3 {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 680px) {
          .payroll-config-hero {
            padding: 20px;
          }

          .payroll-config-hero-icon {
            display: none;
          }

          .payroll-config-tabs {
            width: 100%;
          }

          .payroll-config-tabs button {
            flex: 1;
          }

          .payroll-config-form-grid,
          .payroll-config-form-grid-3 {
            grid-template-columns: 1fr;
          }

          .payroll-component-summary {
            grid-template-columns: 32px minmax(0, 1fr) 18px;
          }

          .payroll-component-summary-value {
            display: none;
          }

          .payroll-config-card {
            padding: 15px;
            border-radius: 17px;
          }

          .payroll-config-section-head,
          .payroll-config-rule-head {
            align-items: stretch;
            flex-direction: column;
          }
        }
      `}</style>
    </section>
  );
}