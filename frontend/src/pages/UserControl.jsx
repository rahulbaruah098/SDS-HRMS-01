import { useEffect, useState } from 'react';
import {
  Plus,
  Save,
  Search,
  KeyRound,
  X,
  ImagePlus,
  Trash2,
  ShieldCheck,
  ShieldOff,
  RefreshCw,
} from 'lucide-react';
import {
  api,
  getInitials,
  getProfilePhotoUrl,
  getSuperAdminTenants,
  getSuperAdminTenantUsers,
  createSuperAdminTenantEmployee,
  changeSuperAdminTenantUserPassword,
  updateSuperAdminTenantUserStatus,
  deleteSuperAdminTenantUser,
} from '../api/client';
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
  profile_photo: '',
  profile_picture: '',
  photo: '',

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
  is_it_support_head: 'false',
  is_it_support_member: 'false',

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
  'confirm_password',
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
  'is_it_support_head',
  'is_it_support_member',

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
  'is_it_support_head',
  'is_it_support_member',

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
  'confirm_password',
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

function boolValue(value) {
  return ['true', 'yes', '1', 'on'].includes(String(value || '').toLowerCase());
}

function boolLabel(value) {
  return boolValue(value) ? 'Yes' : 'No';
}

function textValue(value) {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  return String(value);
}

function profilePhotoValue(record = {}) {
  return (
    record.avatar ||
    record.profile_photo ||
    record.profile_picture ||
    record.photo ||
    record.image ||
    record.picture ||
    ''
  );
}

function applyProfilePhotoAliases(payload = {}, photoValue = '') {
  const photo = String(photoValue || profilePhotoValue(payload) || '').trim();

  if (photo) {
    payload.avatar = photo;
    payload.profile_photo = photo;
    payload.profile_picture = photo;
    payload.photo = photo;
  }

  return payload;
}

function normalizeItSupportFlags(payload = {}) {
  const next = { ...payload };

  next.is_it_support_head = String(next.is_it_support_head ?? 'false');
  next.is_it_support_member = String(next.is_it_support_member ?? 'false');

  if (boolValue(next.is_it_support_head)) {
    next.is_it_support_member = 'true';
  }

  return next;
}

function userEmployeeProfile(user = {}) {
  return user.employee_profile || user.employee || {};
}

function userPhotoValue(user = {}) {
  const employee = userEmployeeProfile(user);

  return profilePhotoValue(employee) || profilePhotoValue(user);
}

function userDisplayName(user = {}) {
  return user.name || user.full_name || user.email || 'User';
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

function employeeIsItSupportHead(user = {}) {
  const employee = userEmployeeProfile(user);
  return boolLabel(employee.is_it_support_head || user.is_it_support_head);
}

function employeeIsItSupportMember(user = {}) {
  const employee = userEmployeeProfile(user);
  return boolLabel(employee.is_it_support_member || user.is_it_support_member);
}

function UserAvatar({ user = {}, size = 'md' }) {
  const photo = userPhotoValue(user);
  const photoUrl = photo ? getProfilePhotoUrl({ avatar: photo }) : '';
  const name = userDisplayName(user);

  return (
    <div className={`uc-avatar uc-avatar-${size}`}>
      {photoUrl ? (
        <img src={photoUrl} alt={name} />
      ) : (
        <span>{getInitials(name)}</span>
      )}
    </div>
  );
}

function ProfilePhotoInput({ state, setState, mode = 'create' }) {
  const photo = profilePhotoValue(state);
  const photoUrl = photo ? getProfilePhotoUrl({ avatar: photo }) : '';
  const name = state.name || state.email || 'Employee';

  function updatePhoto(value) {
    const next = {
      ...state,
    };

    applyProfilePhotoAliases(next, value);

    setState(next);
  }

  function handleFileChange(event) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      alert('Please choose an image file.');
      return;
    }

    if (file.size > 1024 * 1024 * 2) {
      alert('Image size should be below 2MB.');
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      updatePhoto(reader.result || '');
    };

    reader.readAsDataURL(file);
  }

  return (
    <label className="uc-photo-field">
      Profile Photo
      <div className="uc-photo-box">
        <div className="uc-photo-preview">
          {photoUrl ? (
            <img src={photoUrl} alt={name} />
          ) : (
            <span>{getInitials(name)}</span>
          )}
        </div>

        <div className="uc-photo-controls">
          <input
            type="text"
            value={photo}
            placeholder="Paste image URL/path or upload image"
            onChange={(event) => updatePhoto(event.target.value)}
          />

          <div className="uc-photo-actions">
            <label className="uc-file-btn">
              <ImagePlus size={16} />
              Upload Photo
              <input
                type="file"
                accept="image/*"
                onChange={handleFileChange}
              />
            </label>

            {photo && (
              <button
                type="button"
                className="secondary"
                onClick={() => updatePhoto('')}
              >
                Remove
              </button>
            )}
          </div>

          <small>
            {mode === 'create'
              ? 'This photo will be saved with the employee profile and linked login user.'
              : 'Updating this will sync the photo in user control, employee profile, dashboard and project team cards.'}
          </small>
        </div>
      </div>
    </label>
  );
}

export default function UserControl() {
  const [rows, setRows] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [form, setForm] = useState({ ...USER_CREATE_TEMPLATE });
  const [q, setQ] = useState('');
  const [tenant, setTenant] = useState('');
  const [designationFilter, setDesignationFilter] = useState('');
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

  async function loadTenants() {
    const data = await getSuperAdminTenants();
    const items = data.items || [];

    setTenants(items);

    if (!tenant && items.length) {
      const firstTenant = items[0].tenant_id || items[0].value || '';

      setTenant(firstTenant);
      setForm((prev) => ({
        ...prev,
        tenant_id: firstTenant,
      }));

      return firstTenant;
    }

    return tenant;
  }

  async function load(nextTenant = tenant) {
    const cleanTenant = String(nextTenant || '').trim();

    if (!cleanTenant) {
      setRows([]);
      return [];
    }

    const data = await getSuperAdminTenantUsers({
      tenant_id: cleanTenant,
      search: q.trim(),
      q: q.trim(),
      designation: designationFilter.trim(),
    });

    const items = data.items || [];
    setRows(items);
    return items;
  }

  async function loadEmployeeOptions(tenantId = '') {
    const cleanTenant = String(tenantId || tenant || '').trim();
    const url = cleanTenant
      ? `/employees?tenant_id=${encodeURIComponent(cleanTenant)}&limit=500`
      : '/employees?limit=500';
    const data = await api(url);
    const items = data.items || [];

    setEmployeeOptions(items);
    return items;
  }

  async function loadDesignationOptions(tenantId = '') {
    const cleanTenant = String(tenantId || tenant || '').trim();
    const url = cleanTenant
      ? `/designations?tenant_id=${encodeURIComponent(cleanTenant)}&limit=500`
      : '/designations?limit=500';
    const data = await api(url);
    const items = data.items || [];

    setDesignationOptions(items);
    return items;
  }

  async function loadDepartmentOptions(tenantId = '') {
    const cleanTenant = String(tenantId || tenant || '').trim();
    const url = cleanTenant
      ? `/departments?tenant_id=${encodeURIComponent(cleanTenant)}&limit=500`
      : '/departments?limit=500';
    const data = await api(url);
    const items = data.items || [];

    setDepartmentOptions(items);
    return items;
  }

  async function loadHelperOptions(tenantId = '') {
    await Promise.all([
      loadEmployeeOptions(tenantId),
      loadDesignationOptions(tenantId),
      loadDepartmentOptions(tenantId),
    ]);
  }

  function resetCreateForm(nextTenant = tenant) {
    setForm({
      ...USER_CREATE_TEMPLATE,
      tenant_id: nextTenant || '',
    });
  }

  useEffect(() => {
    async function boot() {
      try {
        setLoading(true);
        setMessage('');

        const selectedTenant = await loadTenants();
        await loadHelperOptions(selectedTenant);
        await load(selectedTenant);
      } catch (error) {
        console.error(error);
        setMessage(error.message || 'Unable to load users');
      } finally {
        setLoading(false);
      }
    }

    boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!tenant) {
      return;
    }

    setForm((prev) => ({
      ...prev,
      tenant_id: prev.tenant_id || tenant,
    }));

    loadHelperOptions(tenant).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant]);

  async function searchUsers() {
    try {
      setMessage('');
      setLoading(true);
      await load(tenant);
      await loadHelperOptions(tenant);
    } catch (error) {
      setMessage(error.message || 'Unable to search users');
    } finally {
      setLoading(false);
    }
  }

  async function clearSearch() {
    setQ('');
    setDesignationFilter('');
    setMessage('');

    try {
      setLoading(true);
      const data = await getSuperAdminTenantUsers({ tenant_id: tenant });
      setRows(data.items || []);
      await loadHelperOptions(tenant);
    } catch (error) {
      setMessage(error.message || 'Unable to clear search');
    } finally {
      setLoading(false);
    }
  }

  async function handleTenantChange(nextTenant) {
    const cleanTenant = String(nextTenant || '').trim();

    setTenant(cleanTenant);
    setQ('');
    setDesignationFilter('');
    setMessage('');
    setForm((prev) => ({
      ...prev,
      tenant_id: cleanTenant,
    }));
    setEdit(null);
    setResetTarget(null);

    try {
      setLoading(true);
      await loadHelperOptions(cleanTenant);
      const data = await getSuperAdminTenantUsers({ tenant_id: cleanTenant });
      setRows(data.items || []);
    } catch (error) {
      setMessage(error.message || 'Unable to load selected tenant users');
    } finally {
      setLoading(false);
    }
  }

  function validateUserPayload(payload, mode = 'create') {
    const required = mode === 'create'
      ? REQUIRED_FIELDS
      : REQUIRED_FIELDS.filter((field) => !['password', 'confirm_password'].includes(field));

    for (const field of required) {
      if (
        payload[field] === undefined ||
        payload[field] === null ||
        String(payload[field]).trim() === ''
      ) {
        return `${field.replaceAll('_', ' ')} is required`;
      }
    }

    if (mode === 'create' && payload.password !== payload.confirm_password) {
      return 'Password and confirm password do not match';
    }

    return '';
  }

  function cleanUserPayload(sourcePayload) {
    const payload = normalizeItSupportFlags({
      ...sourcePayload,
      state: normalizeState(sourcePayload.state),
      branch: normalizeState(sourcePayload.branch || sourcePayload.state),
      tenant_id: String(sourcePayload.tenant_id || tenant || '').trim(),
      role: 'Employee',
    });

    applyProfilePhotoAliases(payload);

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

      const data = await createSuperAdminTenantEmployee(payload);

      setMessage(data.message || 'Employee created successfully');
      resetCreateForm(payload.tenant_id);
      await load(payload.tenant_id);
      await loadHelperOptions(payload.tenant_id);
    } catch (error) {
      setMessage(error.message || 'Unable to create employee');
    } finally {
      setSaving(false);
    }
  }

  async function openEdit(user) {
    try {
      setMessage('');

      const employee = user.employee_profile || user.employee || {};
      const photo = profilePhotoValue(employee) || profilePhotoValue(user);

      await loadHelperOptions(user.tenant_id || tenant);

      const editData = {
        ...USER_CREATE_TEMPLATE,
        ...employee,
        ...user,

        user_id_for_edit: user._id,
        employee_id_for_edit: employee._id || user.employee_ref_id || user.employee_id || '',

        roles: normalizeRolesInput(user.roles),

        avatar: photo,
        profile_photo: photo,
        profile_picture: photo,
        photo,

        phone: employee.phone || user.phone || '',
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
        are_parents_senior_citizen: String(employee.are_parents_senior_citizen || 'false'),
        number_of_children: employee.number_of_children || '',
        payment_mode: employee.payment_mode || 'Bank Transfer',
        previous_designation: employee.previous_designation || '',
        previous_employment_tenure_end_date: employee.previous_employment_tenure_end_date || '',
        role: 'Employee',
        designation: employee.designation || user.designation || user.designation_name || '',
        department: employee.department || user.department || user.department_name || '',
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
        dependent_disability_level: employee.dependent_disability_level || 'No Disability',
        children_in_hostel: employee.children_in_hostel || '',
        previous_employer_name: employee.previous_employer_name || '',
        previous_employment_tenure_from_date: employee.previous_employment_tenure_from_date || '',
        employee_id: employee.employee_id || user.emp_code || user.employee_code || '',

        emp_code: employee.emp_code || user.emp_code || user.employee_code || '',
        job_type: employee.job_type || 'Regular',
        project: employee.project || '',
        state: normalizeState(employee.state || employee.branch || user.state || user.branch || 'Assam(HO)'),
        status: employee.status || user.status || 'Active',
        salary: employee.salary || 0,

        is_team_leader: String(employee.is_team_leader || user.is_team_leader || 'false'),
        is_reporting_officer: String(employee.is_reporting_officer || user.is_reporting_officer || 'false'),
        is_it_support_head: String(employee.is_it_support_head || user.is_it_support_head || 'false'),
        is_it_support_member: String(employee.is_it_support_member || user.is_it_support_member || 'false'),

        team_leader_id: employee.team_leader_id || user.team_leader_id || '',
        team_leader_name: employee.team_leader_name || user.team_leader_name || '',
        reporting_officer_id: employee.reporting_officer_id || user.reporting_officer_id || '',
        reporting_officer_name: employee.reporting_officer_name || user.reporting_officer_name || '',

        password: '',
        confirm_password: '',
        is_active: String(user.is_active !== false && user.is_disabled !== true),
      };

      setEdit(normalizeItSupportFlags(editData));

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

    if (payload.password && payload.password !== payload.confirm_password && payload.confirm_password) {
      setMessage('Password and confirm password do not match');
      return;
    }

    try {
      setMessage('');
      setSaving(true);

      delete payload.user_id_for_edit;
      delete payload.employee_id_for_edit;
      delete payload.employee_profile;
      delete payload.employee;
      delete payload.password_hash;
      delete payload.confirm_password;

      payload.is_active = payload.is_active === true || payload.is_active === 'true';

      if (!payload.password) {
        delete payload.password;
      }

      const data = await api(`/superadmin/users/${edit.user_id_for_edit}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });

      setMessage(data.message || 'User/profile updated successfully');
      setEdit(null);
      await load(payload.tenant_id);
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

      const data = await changeSuperAdminTenantUserPassword(resetTarget._id, resetForm);

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

  async function toggleUserStatus(user) {
    if (!user?._id) {
      return;
    }

    const isActive = user.is_active !== false && user.is_disabled !== true;
    const action = isActive ? 'disable' : 'enable';
    const ok = window.confirm(`Are you sure you want to ${action} ${user.name || user.email || 'this user'}?`);

    if (!ok) {
      return;
    }

    try {
      setMessage('');
      setSaving(true);

      const data = await updateSuperAdminTenantUserStatus(user._id, {
        is_active: !isActive,
      });

      setMessage(data.message || (isActive ? 'User disabled successfully' : 'User enabled successfully'));
      await load(tenant);
    } catch (error) {
      setMessage(error.message || 'Unable to update user status');
    } finally {
      setSaving(false);
    }
  }

  async function deleteUser(user) {
    if (!user?._id) {
      return;
    }

    const ok = window.confirm(
      `Delete ${user.name || user.email || 'this user'} from the active database list?`,
    );

    if (!ok) {
      return;
    }

    try {
      setMessage('');
      setSaving(true);

      const data = await deleteSuperAdminTenantUser(user._id);

      setMessage(data.message || 'User deleted successfully');
      await load(tenant);
      await loadHelperOptions(tenant);
    } catch (error) {
      setMessage(error.message || 'Unable to delete user');
    } finally {
      setSaving(false);
    }
  }

  function formatLabel(key) {
    const customLabels = {
      is_it_support_head: 'IT Support Head',
      is_it_support_member: 'IT Support Member',
      confirm_password: 'Confirm Password',
      tenant_id: 'Tenant / Company',
    };

    if (customLabels[key]) {
      return REQUIRED_FIELDS.includes(key) ? `${customLabels[key]} *` : customLabels[key];
    }

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
      team_leader_name: selectedEmployee?.name || selectedEmployee?.employee_name || '',
    });
  }

  function applyReportingOfficerChange(state, setState, employeeId) {
    const selectedEmployee = employeeOptions.find((emp) => emp._id === employeeId);

    setState({
      ...state,
      reporting_officer_id: employeeId,
      reporting_officer_name: selectedEmployee?.name || selectedEmployee?.employee_name || '',
    });
  }

  function renderCommonField(state, setState, key, mode = 'create') {
    const label = formatLabel(key);

    if (key === 'tenant_id') {
      return (
        <label key={key}>
          {label}
          <select
            value={state[key] || ''}
            disabled={mode === 'edit'}
            onChange={(e) => {
              const nextTenant = e.target.value;
              setState({ ...state, [key]: nextTenant });

              if (mode === 'create') {
                handleTenantChange(nextTenant);
              }
            }}
          >
            <option value="">Select tenant</option>
            {tenants.map((item) => (
              <option key={item.tenant_id || item.value} value={item.tenant_id || item.value}>
                {item.name || item.company_name || item.label || item.tenant_id} ({item.tenant_id || item.value})
              </option>
            ))}
          </select>
          <small>
            Super Admin must select the tenant first. Employee and login user will be created inside this tenant only.
          </small>
        </label>
      );
    }

    if (key === 'avatar') {
      return <ProfilePhotoInput key={key} state={state} setState={setState} mode={mode} />;
    }

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
              const value = dept.name || dept.title || dept.department_name || '';
              if (!value) return null;
              return <option key={dept._id || value} value={value}>{value}</option>;
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
              const value = desig.title || desig.name || desig.designation_name || '';
              if (!value) return null;
              return <option key={desig._id || value} value={value}>{value}</option>;
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
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <small>
            Team Leader, Reporting Officer and IT Support duties are employee capabilities, not separate login roles.
          </small>
        </label>
      );
    }

    if (key === 'role') {
      return (
        <label key={key}>
          Employee Profile Role *
          <select value="Employee" onChange={() => setState({ ...state, role: 'Employee' })}>
            <option value="Employee">Employee</option>
          </select>
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

    if (['is_it_support_head', 'is_it_support_member'].includes(key)) {
      return (
        <label key={key}>
          {label}
          <select
            value={String(state[key] ?? 'false')}
            onChange={(e) => {
              const value = e.target.value;
              const next = { ...state, [key]: value };

              if (key === 'is_it_support_head' && boolValue(value)) {
                next.is_it_support_member = 'true';
              }

              setState(next);
            }}
          >
            <option value="false">No</option>
            <option value="true">Yes</option>
          </select>
        </label>
      );
    }

    if (['team_leader_id', 'reporting_officer_id'].includes(key)) {
      const filteredEmployees = employeeOptions.filter((emp) => emp._id !== state.employee_id_for_edit);

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
                {emp.name || emp.employee_name} — {emp.employee_id || emp.emp_code || emp.designation || emp.department || emp.email}
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
          <input type="text" value={state[key] ?? ''} readOnly />
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
              <option key={option || 'empty'} value={option}>{option || 'Choose One'}</option>
            ))}
          </select>
        </label>
      );
    }

    if (DATE_FIELDS.includes(key)) {
      return (
        <label key={key}>
          {label}
          <input type="date" value={state[key] ?? ''} onChange={(e) => setState({ ...state, [key]: e.target.value })} />
        </label>
      );
    }

    if (NUMBER_FIELDS.includes(key)) {
      return (
        <label key={key}>
          {label}
          <input type="number" value={state[key] ?? ''} onChange={(e) => setState({ ...state, [key]: e.target.value })} />
        </label>
      );
    }

    if (key === 'address') {
      return (
        <label key={key}>
          {label}
          <textarea value={state[key] ?? ''} onChange={(e) => setState({ ...state, [key]: e.target.value })} rows={3} />
        </label>
      );
    }

    return (
      <label key={key}>
        {label}
        <input
          type={key === 'password' || key === 'confirm_password' ? 'password' : key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'}
          value={state[key] ?? ''}
          placeholder={mode === 'edit' && key === 'password' ? 'Leave blank if password should not change' : ''}
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
    <div className="page-grid user-control-page superadmin-user-control">
      <style>{`
        .user-control-page .dynamic-form { align-items: start; }
        .uc-photo-field { grid-column: 1 / -1; }
        .uc-photo-box {
          display: grid;
          grid-template-columns: 96px minmax(0, 1fr);
          gap: 16px;
          align-items: center;
          border: 1px solid #e2e8f0;
          border-radius: 20px;
          background: radial-gradient(circle at 0% 0%, rgba(79, 70, 229, .08), transparent 34%), #f8fafc;
          padding: 14px;
          margin-top: 8px;
        }
        .uc-photo-preview {
          width: 88px;
          height: 88px;
          border-radius: 24px;
          overflow: hidden;
          display: grid;
          place-items: center;
          background: linear-gradient(135deg, #eef2ff, #ecfdf5);
          border: 3px solid #ffffff;
          box-shadow: 0 14px 32px rgba(15, 23, 42, .12);
          color: #4338ca;
          font-size: 24px;
          font-weight: 900;
        }
        .uc-photo-preview img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .uc-photo-controls { display: grid; gap: 10px; min-width: 0; }
        .uc-photo-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .uc-file-btn {
          width: auto !important;
          display: inline-flex !important;
          align-items: center;
          justify-content: center;
          gap: 8px;
          border: 0;
          border-radius: 999px;
          background: #eef2ff;
          color: #4338ca;
          padding: 10px 14px;
          font-weight: 800;
          cursor: pointer;
          margin: 0 !important;
        }
        .uc-file-btn input { display: none; }
        .uc-avatar {
          overflow: hidden;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #eef2ff, #ecfdf5);
          color: #4338ca;
          border: 2px solid #ffffff;
          box-shadow: 0 10px 22px rgba(15, 23, 42, .12);
          font-weight: 900;
          flex: 0 0 auto;
        }
        .uc-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .uc-avatar-sm { width: 38px; height: 38px; font-size: 12px; }
        .uc-avatar-md { width: 52px; height: 52px; font-size: 15px; }
        .uc-user-cell { display: flex; align-items: center; gap: 10px; min-width: 190px; }
        .uc-user-cell strong { display: block; color: #0f172a; }
        .uc-user-cell small { display: block; color: #64748b; margin-top: 2px; }
        .uc-tenant-grid {
          display: grid;
          grid-template-columns: minmax(220px, 1.1fr) minmax(180px, 1fr) minmax(180px, 1fr) auto auto;
          gap: 12px;
          align-items: end;
          margin-bottom: 16px;
        }
        .uc-tenant-grid label { margin: 0; }
        .uc-actions { display: flex; flex-wrap: wrap; gap: 8px; }
        .uc-actions button { white-space: nowrap; }
        .uc-danger-soft { background: #fef2f2 !important; color: #b91c1c !important; }
        .uc-warning-soft { background: #fff7ed !important; color: #c2410c !important; }
        .uc-success-soft { background: #ecfdf5 !important; color: #047857 !important; }
        .uc-status-pill {
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          padding: 6px 10px;
          font-size: 12px;
          font-weight: 900;
        }
        .uc-status-pill.active { background: #ecfdf5; color: #047857; }
        .uc-status-pill.disabled { background: #fef2f2; color: #b91c1c; }
        @media (max-width: 980px) { .uc-tenant-grid { grid-template-columns: 1fr 1fr; } }
        @media (max-width: 720px) {
          .uc-photo-box { grid-template-columns: 1fr; }
          .uc-photo-preview { width: 78px; height: 78px; }
          .uc-tenant-grid { grid-template-columns: 1fr; }
        }
      `}</style>

      <section className="hero compact">
        <div>
          <span className="kicker">Super Admin Tenant User Control</span>
          <h1>User Control</h1>
          <p>
            Super Admin can select any tenant, create employees like HR/Admin,
            view tenant-wise users, filter by name/email/designation, reset
            passwords, disable/enable users and delete users from the active
            database list.
          </p>
        </div>
      </section>

      <section className="panel">
        <div className="toolbar">
          <div>
            <h3>Tenant-wise User List</h3>
            <p>Select a tenant first. The table below will show users from only that tenant.</p>
          </div>
        </div>

        <div className="uc-tenant-grid">
          <label>
            Tenant / Company
            <select value={tenant} onChange={(e) => handleTenantChange(e.target.value)}>
              <option value="">Select tenant</option>
              {tenants.map((item) => (
                <option key={item.tenant_id || item.value} value={item.tenant_id || item.value}>
                  {item.name || item.company_name || item.label || item.tenant_id} ({item.tenant_id || item.value})
                </option>
              ))}
            </select>
          </label>

          <label>
            Search Name / Email
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or email" />
          </label>

          <label>
            Designation Filter
            <input value={designationFilter} onChange={(e) => setDesignationFilter(e.target.value)} placeholder="Search by designation" />
          </label>

          <button type="button" onClick={searchUsers} disabled={loading || !tenant}>
            <Search size={16} /> {loading ? 'Searching...' : 'Search'}
          </button>

          <button type="button" className="secondary" onClick={clearSearch} disabled={loading || !tenant}>
            <RefreshCw size={16} /> Clear
          </button>
        </div>

        <form className="dynamic-form" onSubmit={create}>
          <div className="toolbar" style={{ gridColumn: '1 / -1', padding: 0 }}>
            <div>
              <h3>Create Employee</h3>
              <p>Create employee and login user under the selected tenant.</p>
            </div>
          </div>

          {CREATE_FIELD_ORDER.map((key) => renderCreateField(key))}

          <button type="submit" className="primary" disabled={saving || !form.tenant_id}>
            <Plus size={16} /> {saving ? 'Creating...' : 'Create Employee'}
          </button>
        </form>

        {message && <div className="inline-message">{message}</div>}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Photo / Name</th>
                <th>Email</th>
                <th>Tenant</th>
                <th>Employee ID / Code</th>
                <th>Login Access</th>
                <th>Department</th>
                <th>Designation</th>
                <th>State</th>
                <th>Team Leader Capability</th>
                <th>Reporting Officer Capability</th>
                <th>IT Support Head</th>
                <th>IT Support Member</th>
                <th>Mapped Team Leader</th>
                <th>Mapped Reporting Officer</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((user) => {
                const isActive = user.is_active !== false && user.is_disabled !== true;

                return (
                  <tr key={user._id}>
                    <td>
                      <div className="uc-user-cell">
                        <UserAvatar user={user} size="sm" />
                        <div>
                          <strong>{textValue(user.name || user.employee_name)}</strong>
                          <small>{employeeIdValue(user)}</small>
                        </div>
                      </div>
                    </td>
                    <td>{textValue(user.email)}</td>
                    <td>{textValue(user.tenant_id)}</td>
                    <td>{employeeIdValue(user)}</td>
                    <td>{displayRoles(user.roles)}</td>
                    <td>{employeeDepartmentValue(user)}</td>
                    <td>{employeeDesignationValue(user)}</td>
                    <td>{employeeStateValue(user)}</td>
                    <td>{employeeIsTeamLeader(user)}</td>
                    <td>{employeeIsReportingOfficer(user)}</td>
                    <td>{employeeIsItSupportHead(user)}</td>
                    <td>{employeeIsItSupportMember(user)}</td>
                    <td>{employeeTeamLeaderName(user)}</td>
                    <td>{employeeReportingOfficerName(user)}</td>
                    <td>
                      <span className={`uc-status-pill ${isActive ? 'active' : 'disabled'}`}>
                        {isActive ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td>
                      <div className="uc-actions">
                        <button type="button" className="secondary" onClick={() => openEdit(user)} disabled={saving}>
                          Edit
                        </button>
                        <button type="button" className="secondary" onClick={() => openReset(user)} disabled={saving}>
                          <KeyRound size={15} /> Password
                        </button>
                        <button
                          type="button"
                          className={isActive ? 'secondary uc-warning-soft' : 'secondary uc-success-soft'}
                          onClick={() => toggleUserStatus(user)}
                          disabled={saving}
                        >
                          {isActive ? <ShieldOff size={15} /> : <ShieldCheck size={15} />}
                          {isActive ? 'Disable' : 'Enable'}
                        </button>
                        <button type="button" className="danger uc-danger-soft" onClick={() => deleteUser(user)} disabled={saving}>
                          <Trash2 size={15} /> Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {!rows.length && (
            <div className="empty">
              {loading ? 'Loading users...' : tenant ? 'No users found for this tenant' : 'Please select a tenant'}
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
                Update login details, employee profile, profile photo, designation,
                state, Team Leader capability, Reporting Officer capability, IT
                Support capability and employee reporting mapping.
              </p>
            </div>

            <button type="button" className="secondary" onClick={() => setEdit(null)} disabled={saving}>
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
              <h3>Change Password</h3>
              <p>Change password for <b>{resetTarget.name}</b> — {resetTarget.email}</p>
            </div>

            <button type="button" className="secondary" onClick={() => setResetTarget(null)} disabled={saving}>
              <X size={16} /> Close
            </button>
          </div>

          <form className="dynamic-form" onSubmit={submitReset}>
            <label>
              New Password
              <input
                type="password"
                value={resetForm.password}
                onChange={(e) => setResetForm({ ...resetForm, password: e.target.value })}
              />
            </label>

            <label>
              Confirm Password
              <input
                type="password"
                value={resetForm.confirm_password}
                onChange={(e) => setResetForm({ ...resetForm, confirm_password: e.target.value })}
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
