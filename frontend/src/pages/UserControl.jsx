import { useEffect, useState } from 'react';
import { Plus, Save, Search, KeyRound, X } from 'lucide-react';
import { api } from '../api/client';
import { emptyUser } from '../data/modules';

const HOLIDAY_STATES = [
  'Assam(HO)',
  'Manipur',
  'Mizoram',
  'Arunachal Pradesh',
];

const USER_CREATE_TEMPLATE = {
  ...emptyUser,

  avatar: '',
  phone: '',
  country: 'India',
  joining_date: '',
  date_of_birth: '',
  blood_group: '',
  gross_salary: '',
  branch: 'Assam(HO)',
  aadhar_no: '',
  employee_uan_no: '',
  employee_type: '',
  skill_level: '',
  are_parents_senior_citizen: 'false',
  number_of_children: '',
  payment_mode: 'Bank Transfer',
  previous_designation: '',
  previous_employment_tenure_end_date: '',

  // Main employee profile role must remain Employee.
  // Team Leader / Reporting Officer are handled by mapping fields below.
  role: 'Employee',
  roles: 'employee',

  designation: 'Employee',
  department: 'HR & Admin',
  shift: 'General',
  gender: 'Male',
  address: '',
  religion: '',
  marital_status: '',
  speak_language: '',
  pan_no: '',
  disability_level: 'No Disability',
  employee_esic_ip: '',
  employment_status: 'Active',
  father_name: '',
  dependent_disability_level: 'No Disability',
  children_in_hostel: '',
  previous_employer_name: '',
  previous_employment_tenure_from_date: '',
  employee_id: '',

  emp_code: '',
  job_type: 'Regular',
  project: '',
  state: 'Assam(HO)',
  status: 'Active',
  salary: 0,

  is_team_leader: 'false',
  is_reporting_officer: 'false',
  team_leader_id: '',
  team_leader_name: '',
  reporting_officer_id: '',
  reporting_officer_name: '',
};

const CREATE_FIELD_ORDER = [
  'tenant_id',
  'name',
  'email',
  'password',
  'roles',

  'avatar',
  'phone',
  'country',
  'joining_date',
  'date_of_birth',
  'blood_group',
  'gross_salary',
  'branch',
  'aadhar_no',
  'employee_uan_no',
  'employee_type',
  'skill_level',
  'are_parents_senior_citizen',
  'number_of_children',
  'payment_mode',
  'previous_designation',
  'previous_employment_tenure_end_date',
  'role',
  'designation',
  'department',
  'shift',
  'gender',
  'address',
  'religion',
  'marital_status',
  'speak_language',
  'pan_no',
  'disability_level',
  'employee_esic_ip',
  'employment_status',
  'father_name',
  'dependent_disability_level',
  'children_in_hostel',
  'previous_employer_name',
  'previous_employment_tenure_from_date',
  'employee_id',

  'emp_code',
  'job_type',
  'project',
  'state',
  'status',
  'salary',
  'is_active',

  'is_team_leader',
  'is_reporting_officer',
  'team_leader_id',
  'team_leader_name',
  'reporting_officer_id',
  'reporting_officer_name',
];

const EDIT_FIELD_ORDER = [
  'name',
  'email',
  'tenant_id',
  'roles',
  'password',

  'avatar',
  'phone',
  'country',
  'joining_date',
  'date_of_birth',
  'blood_group',
  'gross_salary',
  'branch',
  'aadhar_no',
  'employee_uan_no',
  'employee_type',
  'skill_level',
  'are_parents_senior_citizen',
  'number_of_children',
  'payment_mode',
  'previous_designation',
  'previous_employment_tenure_end_date',
  'role',
  'designation',
  'department',
  'shift',
  'gender',
  'address',
  'religion',
  'marital_status',
  'speak_language',
  'pan_no',
  'disability_level',
  'employee_esic_ip',
  'employment_status',
  'father_name',
  'dependent_disability_level',
  'children_in_hostel',
  'previous_employer_name',
  'previous_employment_tenure_from_date',
  'employee_id',

  'emp_code',
  'job_type',
  'project',
  'state',
  'status',
  'salary',
  'is_active',

  'is_team_leader',
  'is_reporting_officer',
  'team_leader_id',
  'team_leader_name',
  'reporting_officer_id',
  'reporting_officer_name',
];

const REQUIRED_FIELDS = [
  'tenant_id',
  'name',
  'email',
  'password',
  'roles',
  'phone',
  'country',
  'joining_date',
  'gross_salary',
  'branch',
  'are_parents_senior_citizen',
  'payment_mode',
  'role',
  'designation',
  'department',
  'shift',
  'gender',
  'disability_level',
  'state',
];

const SELECT_OPTIONS = {
  country: ['India'],
  blood_group: ['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
  employee_type: ['', 'Permanent', 'Contractual', 'Intern', 'Consultant'],
  skill_level: ['', 'Skilled', 'Semi Skilled', 'Unskilled', 'Highly Skilled'],
  payment_mode: ['Cash', 'Bank Transfer', 'UPI', 'Cheque'],

  // Do not create Team Leader / Reporting Officer as separate employee roles.
  role: ['Employee'],

  shift: ['General', 'Morning', 'Evening', 'Night'],
  gender: ['Male', 'Female', 'Other'],
  religion: ['', 'Hindu', 'Muslim', 'Christian', 'Sikh', 'Buddhist', 'Jain', 'Other'],
  marital_status: ['', 'Single', 'Married', 'Divorced', 'Widowed'],
  disability_level: ['No Disability', 'Mild', 'Moderate', 'Severe'],
  dependent_disability_level: ['No Disability', 'Mild', 'Moderate', 'Severe'],
  employment_status: ['', 'Active', 'Probation', 'Confirmed', 'Resigned', 'Terminated'],
  job_type: ['', 'Regular', 'Contractual', 'Intern', 'Consultant'],
  status: ['Active', 'Inactive'],
  state: HOLIDAY_STATES,
  branch: HOLIDAY_STATES,
};

const LOGIN_ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'hr_admin', label: 'HR Admin' },
  { value: 'hr_manager', label: 'HR Manager' },
  { value: 'hr', label: 'HR' },
  { value: 'finance', label: 'Finance' },
  { value: 'accounts_finance', label: 'Accounts Finance' },
  { value: 'employee', label: 'Employee' },
];

const DATE_FIELDS = [
  'joining_date',
  'date_of_birth',
  'previous_employment_tenure_end_date',
  'previous_employment_tenure_from_date',
];

const NUMBER_FIELDS = [
  'gross_salary',
  'salary',
  'number_of_children',
  'children_in_hostel',
];

function normalizeState(value) {
  const state = String(value || '').trim();

  if (!state) return 'Assam(HO)';

  const lowered = state.toLowerCase();

  if (
    lowered === 'assam' ||
    lowered === 'assam ho' ||
    lowered === 'assam(ho)' ||
    lowered === 'ho' ||
    lowered === 'assam/guwahati (ho)'
  ) {
    return 'Assam(HO)';
  }

  const matched = HOLIDAY_STATES.find(
    (item) => item.toLowerCase() === lowered,
  );

  return matched || state;
}

function normalizeRolesInput(value) {
  if (Array.isArray(value)) {
    const cleanRoles = value.filter(
      (role) =>
        !['team_leader', 'reporting_officer', 'manager', 'ro'].includes(role),
    );

    return cleanRoles.length ? cleanRoles.join(', ') : 'employee';
  }

  const text = String(value || 'employee').trim();

  if (['team_leader', 'reporting_officer', 'manager', 'ro'].includes(text)) {
    return 'employee';
  }

  return text || 'employee';
}

function displayRoles(value) {
  if (!value) return 'employee';

  const roles = Array.isArray(value)
    ? value
    : String(value)
        .split(',')
        .map((role) => role.trim())
        .filter(Boolean);

  const cleaned = roles.map((role) => {
    if (role === 'team_leader') return 'team leader capability';
    if (role === 'reporting_officer') return 'reporting officer capability';
    if (role === 'manager') return 'manager capability';
    if (role === 'ro') return 'reporting officer capability';

    return role;
  });

  return cleaned.join(', ');
}

function boolLabel(value) {
  return ['true', 'yes', '1', 'on'].includes(String(value || '').toLowerCase())
    ? 'Yes'
    : 'No';
}

function textValue(value) {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  return String(value);
}

function userEmployeeProfile(user = {}) {
  return user.employee_profile || {};
}

function employeeIdValue(user = {}) {
  const employee = userEmployeeProfile(user);

  return (
    employee.employee_id ||
    employee.emp_code ||
    user.emp_code ||
    user.employee_code ||
    user.employee_ref_id ||
    user.employee_id ||
    '—'
  );
}

function employeeDepartmentValue(user = {}) {
  const employee = userEmployeeProfile(user);
  return employee.department || user.department || '—';
}

function employeeDesignationValue(user = {}) {
  const employee = userEmployeeProfile(user);
  return employee.designation || user.designation || '—';
}

function employeeStateValue(user = {}) {
  const employee = userEmployeeProfile(user);
  return employee.state || employee.branch || user.state || user.branch || '—';
}

function employeeTeamLeaderName(user = {}) {
  const employee = userEmployeeProfile(user);
  return employee.team_leader_name || user.team_leader_name || '—';
}

function employeeReportingOfficerName(user = {}) {
  const employee = userEmployeeProfile(user);
  return employee.reporting_officer_name || user.reporting_officer_name || '—';
}

function employeeIsTeamLeader(user = {}) {
  const employee = userEmployeeProfile(user);
  return boolLabel(employee.is_team_leader || user.is_team_leader);
}

function employeeIsReportingOfficer(user = {}) {
  const employee = userEmployeeProfile(user);
  return boolLabel(employee.is_reporting_officer || user.is_reporting_officer);
}

export default function UserControl() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ ...USER_CREATE_TEMPLATE });
  const [q, setQ] = useState('');
  const [tenant, setTenant] = useState('');
  const [edit, setEdit] = useState(null);
  const [message, setMessage] = useState('');
  const [employeeOptions, setEmployeeOptions] = useState([]);
  const [designationOptions, setDesignationOptions] = useState([]);
  const [departmentOptions, setDepartmentOptions] = useState([]);
  const [resetTarget, setResetTarget] = useState(null);
  const [resetForm, setResetForm] = useState({
    password: '',
    confirm_password: '',
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  function buildQueryParams() {
    const params = [];

    if (q.trim()) {
      params.push(`q=${encodeURIComponent(q.trim())}`);
    }

    if (tenant.trim()) {
      params.push(`tenant_id=${encodeURIComponent(tenant.trim())}`);
    }

    return params;
  }

  async function load() {
    const params = buildQueryParams();

    const data = await api(
      `/superadmin/users${params.length ? `?${params.join('&')}` : ''}`,
    );

    setRows(data.items || []);
    return data.items || [];
  }

  async function loadEmployeeOptions(tenantId = '') {
    const cleanTenant = (tenantId || tenant || '').trim();

    const url = cleanTenant
      ? `/employees?tenant_id=${encodeURIComponent(cleanTenant)}`
      : '/employees';

    const data = await api(url);
    const items = data.items || [];

    setEmployeeOptions(items);
    return items;
  }

  async function loadDesignationOptions(tenantId = '') {
    const cleanTenant = (tenantId || tenant || '').trim();

    const url = cleanTenant
      ? `/designations?tenant_id=${encodeURIComponent(cleanTenant)}`
      : '/designations';

    const data = await api(url);
    const items = data.items || [];

    setDesignationOptions(items);
    return items;
  }

  async function loadDepartmentOptions(tenantId = '') {
    const cleanTenant = (tenantId || tenant || '').trim();

    const url = cleanTenant
      ? `/departments?tenant_id=${encodeURIComponent(cleanTenant)}`
      : '/departments';

    const data = await api(url);
    const items = data.items || [];

    setDepartmentOptions(items);
    return items;
  }

  async function loadHelperOptions(tenantId = '') {
    await loadEmployeeOptions(tenantId);
    await loadDesignationOptions(tenantId);
    await loadDepartmentOptions(tenantId);
  }

  function resetCreateForm() {
    setForm({ ...USER_CREATE_TEMPLATE });
  }

  useEffect(() => {
    setLoading(true);

    load()
      .catch((error) => {
        console.error(error);
        setMessage(error.message || 'Unable to load users');
      })
      .finally(() => setLoading(false));

    loadHelperOptions().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function searchUsers() {
    try {
      setMessage('');
      setLoading(true);

      await load();
      await loadHelperOptions(tenant);
    } catch (error) {
      setMessage(error.message || 'Unable to search users');
    } finally {
      setLoading(false);
    }
  }

  async function clearSearch() {
    setQ('');
    setTenant('');
    setMessage('');

    try {
      setLoading(true);

      const data = await api('/superadmin/users');
      setRows(data.items || []);

      await loadHelperOptions('');
    } catch (error) {
      setMessage(error.message || 'Unable to clear search');
    } finally {
      setLoading(false);
    }
  }

  function validateUserPayload(payload, mode = 'create') {
    const required = mode === 'create'
      ? REQUIRED_FIELDS
      : REQUIRED_FIELDS.filter((field) => field !== 'password');

    for (const field of required) {
      if (
        payload[field] === undefined ||
        payload[field] === null ||
        String(payload[field]).trim() === ''
      ) {
        return `${field.replaceAll('_', ' ')} is required`;
      }
    }

    return '';
  }

  function cleanUserPayload(sourcePayload) {
    const payload = {
      ...sourcePayload,
      state: normalizeState(sourcePayload.state),
      branch: normalizeState(sourcePayload.branch || sourcePayload.state),
      role: 'Employee',
    };

    if (
      ['team_leader', 'reporting_officer', 'manager', 'ro'].includes(
        String(payload.roles || '').trim(),
      )
    ) {
      payload.roles = 'employee';
    }

    return payload;
  }

  async function create(e) {
    e.preventDefault();

    const payload = cleanUserPayload(form);
    const validationMessage = validateUserPayload(payload, 'create');

    if (validationMessage) {
      setMessage(validationMessage);
      return;
    }

    try {
      setMessage('');
      setSaving(true);

      const data = await api('/superadmin/users', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setMessage(data.message || 'User created successfully');
      resetCreateForm();
      await load();
      await loadHelperOptions(form.tenant_id);
    } catch (error) {
      setMessage(error.message || 'Unable to create user');
    } finally {
      setSaving(false);
    }
  }

  async function openEdit(user) {
    try {
      setMessage('');

      const employee = user.employee_profile || {};

      await loadHelperOptions(user.tenant_id);

      const editData = {
        ...USER_CREATE_TEMPLATE,
        ...employee,
        ...user,

        user_id_for_edit: user._id,
        employee_id_for_edit: employee._id || user.employee_ref_id || '',

        roles: normalizeRolesInput(user.roles),

        avatar: employee.avatar || '',
        phone: employee.phone || '',
        country: employee.country || 'India',
        joining_date: employee.joining_date || '',
        date_of_birth: employee.date_of_birth || '',
        blood_group: employee.blood_group || '',
        gross_salary: employee.gross_salary || '',
        branch: normalizeState(employee.branch || employee.state || user.branch || user.state || 'Assam(HO)'),
        aadhar_no: employee.aadhar_no || '',
        employee_uan_no: employee.employee_uan_no || '',
        employee_type: employee.employee_type || '',
        skill_level: employee.skill_level || '',
        are_parents_senior_citizen: String(
          employee.are_parents_senior_citizen || 'false',
        ),
        number_of_children: employee.number_of_children || '',
        payment_mode: employee.payment_mode || 'Bank Transfer',
        previous_designation: employee.previous_designation || '',
        previous_employment_tenure_end_date:
          employee.previous_employment_tenure_end_date || '',
        role: 'Employee',
        designation: employee.designation || user.designation || '',
        department: employee.department || user.department || '',
        shift: employee.shift || 'General',
        gender: employee.gender || 'Male',
        address: employee.address || '',
        religion: employee.religion || '',
        marital_status: employee.marital_status || '',
        speak_language: employee.speak_language || '',
        pan_no: employee.pan_no || '',
        disability_level: employee.disability_level || 'No Disability',
        employee_esic_ip: employee.employee_esic_ip || '',
        employment_status: employee.employment_status || 'Active',
        father_name: employee.father_name || '',
        dependent_disability_level:
          employee.dependent_disability_level || 'No Disability',
        children_in_hostel: employee.children_in_hostel || '',
        previous_employer_name: employee.previous_employer_name || '',
        previous_employment_tenure_from_date:
          employee.previous_employment_tenure_from_date || '',
        employee_id: employee.employee_id || user.emp_code || '',

        emp_code: employee.emp_code || user.emp_code || '',
        job_type: employee.job_type || 'Regular',
        project: employee.project || '',
        state: normalizeState(employee.state || employee.branch || user.state || user.branch || 'Assam(HO)'),
        status: employee.status || user.status || 'Active',
        salary: employee.salary || 0,

        is_team_leader: String(employee.is_team_leader || user.is_team_leader || 'false'),
        is_reporting_officer: String(employee.is_reporting_officer || user.is_reporting_officer || 'false'),

        team_leader_id: employee.team_leader_id || user.team_leader_id || '',
        team_leader_name: employee.team_leader_name || user.team_leader_name || '',
        reporting_officer_id: employee.reporting_officer_id || user.reporting_officer_id || '',
        reporting_officer_name: employee.reporting_officer_name || user.reporting_officer_name || '',

        password: '',
        is_active: String(user.is_active !== false),
      };

      setEdit(editData);

      setTimeout(() => {
        document.getElementById('user-edit-section')?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      }, 100);
    } catch (error) {
      setMessage(error.message || 'Unable to open edit form');
    }
  }

  async function save(e) {
    e.preventDefault();

    const payload = cleanUserPayload(edit);
    const validationMessage = validateUserPayload(payload, 'edit');

    if (validationMessage) {
      setMessage(validationMessage);
      return;
    }

    try {
      setMessage('');
      setSaving(true);

      delete payload.user_id_for_edit;
      delete payload.employee_id_for_edit;
      delete payload.employee_profile;
      delete payload.password_hash;

      payload.is_active =
        payload.is_active === true || payload.is_active === 'true';

      if (!payload.password) {
        delete payload.password;
      }

      const data = await api(`/superadmin/users/${edit.user_id_for_edit}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });

      setMessage(data.message || 'User/profile updated successfully');
      setEdit(null);
      await load();
      await loadHelperOptions(payload.tenant_id);
    } catch (error) {
      setMessage(error.message || 'Unable to save user');
    } finally {
      setSaving(false);
    }
  }

  function openReset(user) {
    setResetTarget(user);
    setResetForm({
      password: '',
      confirm_password: '',
    });

    setTimeout(() => {
      document.getElementById('password-reset-section')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 100);
  }

  async function submitReset(e) {
    e.preventDefault();

    if (!resetTarget?._id) {
      setMessage('No user selected for password reset');
      return;
    }

    if (!resetForm.password || resetForm.password.length < 6) {
      setMessage('Password must be at least 6 characters');
      return;
    }

    if (resetForm.password !== resetForm.confirm_password) {
      setMessage('Password and confirm password do not match');
      return;
    }

    try {
      setMessage('');
      setSaving(true);

      const data = await api(`/superadmin/users/${resetTarget._id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ password: resetForm.password }),
      });

      setMessage(data.message || 'Password updated successfully');
      setResetTarget(null);
      setResetForm({
        password: '',
        confirm_password: '',
      });
    } catch (error) {
      setMessage(error.message || 'Unable to reset password');
    } finally {
      setSaving(false);
    }
  }

  function formatLabel(key) {
    const labelText = key
      .replaceAll('_', ' ')
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');

    return REQUIRED_FIELDS.includes(key) ? `${labelText} *` : labelText;
  }

  function applyTeamLeaderChange(state, setState, employeeId) {
    const selectedEmployee = employeeOptions.find((emp) => emp._id === employeeId);

    setState({
      ...state,
      team_leader_id: employeeId,
      team_leader_name: selectedEmployee?.name || '',
    });
  }

  function applyReportingOfficerChange(state, setState, employeeId) {
    const selectedEmployee = employeeOptions.find((emp) => emp._id === employeeId);

    setState({
      ...state,
      reporting_officer_id: employeeId,
      reporting_officer_name: selectedEmployee?.name || '',
    });
  }

  function renderCommonField(state, setState, key, mode = 'create') {
    const label = formatLabel(key);

    if (key === 'department') {
      return (
        <label key={key}>
          {label}
          <select
            value={state[key] ?? ''}
            onChange={(e) => setState({ ...state, [key]: e.target.value })}
          >
            <option value="">Select department</option>

            {departmentOptions.map((dept) => {
              const value = dept.name || dept.title || '';

              if (!value) {
                return null;
              }

              return (
                <option key={dept._id || value} value={value}>
                  {value}
                </option>
              );
            })}
          </select>
        </label>
      );
    }

    if (key === 'designation') {
      return (
        <label key={key}>
          {label}
          <select
            value={state[key] ?? ''}
            onChange={(e) => setState({ ...state, designation: e.target.value })}
          >
            <option value="">Select designation</option>

            {designationOptions.map((desig) => {
              const value = desig.title || desig.name || '';

              if (!value) {
                return null;
              }

              return (
                <option key={desig._id || value} value={value}>
                  {value}
                </option>
              );
            })}
          </select>
        </label>
      );
    }

    if (key === 'roles') {
      return (
        <label key={key}>
          Login Access Role *
          <select
            value={state[key] ?? 'employee'}
            onChange={(e) => setState({ ...state, [key]: e.target.value })}
          >
            {LOGIN_ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <small>
            Team Leader and Reporting Officer are not login roles. Use the
            mapping fields below to mark those responsibilities.
          </small>
        </label>
      );
    }

    if (key === 'role') {
      return (
        <label key={key}>
          Employee Profile Role *
          <select
            value="Employee"
            onChange={() => setState({ ...state, role: 'Employee' })}
          >
            <option value="Employee">Employee</option>
          </select>
          <small>
            Every staff profile remains Employee. Leadership responsibility is
            managed by Team Leader / Reporting Officer mapping.
          </small>
        </label>
      );
    }

    if (key === 'is_active') {
      return (
        <label key={key}>
          {label}
          <select
            value={String(state[key] ?? 'true')}
            onChange={(e) => setState({ ...state, [key]: e.target.value })}
          >
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </label>
      );
    }

    if (key === 'are_parents_senior_citizen') {
      return (
        <label key={key}>
          {label}
          <select
            value={String(state[key] ?? 'false')}
            onChange={(e) => setState({ ...state, [key]: e.target.value })}
          >
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </label>
      );
    }

    if (['is_team_leader', 'is_reporting_officer'].includes(key)) {
      return (
        <label key={key}>
          {label}
          <select
            value={String(state[key] ?? 'false')}
            onChange={(e) => setState({ ...state, [key]: e.target.value })}
          >
            <option value="false">No</option>
            <option value="true">Yes</option>
          </select>
        </label>
      );
    }

    if (['team_leader_id', 'reporting_officer_id'].includes(key)) {
      const filteredEmployees = employeeOptions.filter(
        (emp) => emp._id !== state.employee_id_for_edit,
      );

      return (
        <label key={key}>
          {label}
          <select
            value={state[key] ?? ''}
            onChange={(e) => {
              if (key === 'team_leader_id') {
                applyTeamLeaderChange(state, setState, e.target.value);
                return;
              }

              applyReportingOfficerChange(state, setState, e.target.value);
            }}
          >
            <option value="">Select {key.replaceAll('_', ' ')}</option>

            {filteredEmployees.map((emp) => (
              <option key={emp._id} value={emp._id}>
                {emp.name} — {emp.employee_id || emp.emp_code || emp.designation || emp.department || emp.email}
              </option>
            ))}
          </select>
        </label>
      );
    }

    if (['team_leader_name', 'reporting_officer_name'].includes(key)) {
      return (
        <label key={key}>
          {label}
          <input
            type="text"
            value={state[key] ?? ''}
            readOnly
            placeholder={
              key === 'team_leader_name'
                ? 'Team leader name'
                : 'Reporting officer name'
            }
          />
        </label>
      );
    }

    if (SELECT_OPTIONS[key]) {
      return (
        <label key={key}>
          {label}
          <select
            value={state[key] ?? ''}
            onChange={(e) => {
              const value = ['state', 'branch'].includes(key)
                ? normalizeState(e.target.value)
                : e.target.value;

              setState({ ...state, [key]: value });
            }}
          >
            {SELECT_OPTIONS[key].map((option) => (
              <option key={option || 'empty'} value={option}>
                {option || 'Choose One'}
              </option>
            ))}
          </select>
        </label>
      );
    }

    if (DATE_FIELDS.includes(key)) {
      return (
        <label key={key}>
          {label}
          <input
            type="date"
            value={state[key] ?? ''}
            onChange={(e) => setState({ ...state, [key]: e.target.value })}
          />
        </label>
      );
    }

    if (NUMBER_FIELDS.includes(key)) {
      return (
        <label key={key}>
          {label}
          <input
            type="number"
            value={state[key] ?? ''}
            onChange={(e) => setState({ ...state, [key]: e.target.value })}
          />
        </label>
      );
    }

    if (key === 'address') {
      return (
        <label key={key}>
          {label}
          <textarea
            value={state[key] ?? ''}
            onChange={(e) => setState({ ...state, [key]: e.target.value })}
            rows={3}
            placeholder="Address"
          />
        </label>
      );
    }

    return (
      <label key={key}>
        {label}
        <input
          type={
            key === 'password'
              ? 'password'
              : key === 'email'
                ? 'email'
                : key === 'phone'
                  ? 'tel'
                  : 'text'
          }
          value={state[key] ?? ''}
          placeholder={
            mode === 'edit' && key === 'password'
              ? 'Leave blank if password should not change'
              : ''
          }
          onChange={(e) => setState({ ...state, [key]: e.target.value })}
        />
      </label>
    );
  }

  function renderCreateField(key) {
    return renderCommonField(form, setForm, key, 'create');
  }

  function renderEditField(key) {
    return renderCommonField(edit, setEdit, key, 'edit');
  }

  return (
    <div className="page-grid">
      <section className="hero compact">
        <div>
          <span className="kicker">User + Profile + Password Control</span>
          <h1>User Control</h1>
          <p>
            Super Admin can create users, update employee profile, assign team
            leader, assign reporting officer, change login access and reset
            passwords. Team Leader and Reporting Officer are employee mappings,
            not separate login roles.
          </p>
        </div>
      </section>

      <section className="panel">
        <div className="toolbar">
          <div className="search">
            <Search size={16} />

            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search users..."
            />

            <input
              value={tenant}
              onChange={(e) => setTenant(e.target.value)}
              placeholder="tenant_id filter"
            />

            <button type="button" onClick={searchUsers} disabled={loading}>
              {loading ? 'Searching...' : 'Search'}
            </button>

            {(q || tenant) && (
              <button
                type="button"
                className="secondary"
                onClick={clearSearch}
                disabled={loading}
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <form className="dynamic-form" onSubmit={create}>
          {CREATE_FIELD_ORDER.map((key) => renderCreateField(key))}

          <button type="submit" className="primary" disabled={saving}>
            <Plus size={16} /> {saving ? 'Creating...' : 'Create User'}
          </button>
        </form>

        {message && <div className="inline-message">{message}</div>}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Tenant</th>
                <th>Employee ID / Code</th>
                <th>Login Access</th>
                <th>Department</th>
                <th>Designation</th>
                <th>State</th>
                <th>Team Leader Capability</th>
                <th>Reporting Officer Capability</th>
                <th>Mapped Team Leader</th>
                <th>Mapped Reporting Officer</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((user) => (
                <tr key={user._id}>
                  <td>{textValue(user.name)}</td>
                  <td>{textValue(user.email)}</td>
                  <td>{textValue(user.tenant_id)}</td>
                  <td>{employeeIdValue(user)}</td>
                  <td>{displayRoles(user.roles)}</td>
                  <td>{employeeDepartmentValue(user)}</td>
                  <td>{employeeDesignationValue(user)}</td>
                  <td>{employeeStateValue(user)}</td>
                  <td>{employeeIsTeamLeader(user)}</td>
                  <td>{employeeIsReportingOfficer(user)}</td>
                  <td>{employeeTeamLeaderName(user)}</td>
                  <td>{employeeReportingOfficerName(user)}</td>
                  <td>{user.is_active ? 'Active' : 'Inactive'}</td>

                  <td>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => openEdit(user)}
                      disabled={saving}
                    >
                      Edit
                    </button>

                    <button
                      type="button"
                      className="danger"
                      onClick={() => openReset(user)}
                      disabled={saving}
                    >
                      Reset Password
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!rows.length && (
            <div className="empty">
              {loading ? 'Loading users...' : 'No users found'}
            </div>
          )}
        </div>
      </section>

      {edit && (
        <section className="panel" id="user-edit-section">
          <div className="toolbar">
            <div>
              <h3>Edit Complete User Profile</h3>
              <p>
                Update login details, employee profile, designation, state,
                Team Leader capability, Reporting Officer capability and
                employee reporting mapping.
              </p>
            </div>

            <button
              type="button"
              className="secondary"
              onClick={() => setEdit(null)}
              disabled={saving}
            >
              <X size={16} /> Close
            </button>
          </div>

          <form className="dynamic-form" onSubmit={save}>
            {EDIT_FIELD_ORDER.map((key) => renderEditField(key))}

            <button type="submit" className="primary" disabled={saving}>
              <Save size={16} /> {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </form>
        </section>
      )}

      {resetTarget && (
        <section className="panel" id="password-reset-section">
          <div className="toolbar">
            <div>
              <h3>Reset Password</h3>
              <p>
                Reset password for <b>{resetTarget.name}</b> — {resetTarget.email}
              </p>
            </div>

            <button
              type="button"
              className="secondary"
              onClick={() => setResetTarget(null)}
              disabled={saving}
            >
              <X size={16} /> Close
            </button>
          </div>

          <form className="dynamic-form" onSubmit={submitReset}>
            <label>
              New Password
              <input
                type="password"
                value={resetForm.password}
                onChange={(e) =>
                  setResetForm({ ...resetForm, password: e.target.value })
                }
              />
            </label>

            <label>
              Confirm Password
              <input
                type="password"
                value={resetForm.confirm_password}
                onChange={(e) =>
                  setResetForm({
                    ...resetForm,
                    confirm_password: e.target.value,
                  })
                }
              />
            </label>

            <button type="submit" className="primary" disabled={saving}>
              <KeyRound size={16} /> {saving ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}