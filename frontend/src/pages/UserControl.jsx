import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  CheckCircle2,
  AlertTriangle,
  Loader2,
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

const USER_TABLE_PAGE_SIZE_OPTIONS = [25, 50, 100, 200];
const DEFAULT_USER_TABLE_PAGE_SIZE = 25;
const USER_POPUP_AUTO_HIDE_MS = 3600;

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


function UserControlConfirmPopup({ popup, onClose, onConfirm }) {
  if (!popup || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      className="uc-confirm-popup-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={popup.title || 'Please Confirm'}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
       className={`uc-confirm-popup-card ${popup.danger ? 'is-danger' : 'is-confirm'}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="uc-confirm-popup-head">
          <div className={`uc-confirm-popup-icon ${popup.danger ? 'danger' : 'confirm'}`}>
            {popup.danger ? <AlertTriangle size={22} /> : <ShieldCheck size={22} />}
          </div>

          <div className="uc-confirm-popup-title">
            <span>User Control</span>
            <h3>{popup.title || 'Please Confirm'}</h3>
          </div>

          <button
            type="button"
            className="uc-confirm-popup-close"
            onClick={onClose}
            aria-label="Close confirmation"
          >
            <X size={17} />
          </button>
        </header>

        <div className="uc-confirm-popup-body">
          <p>{popup.message}</p>
        </div>

        <footer className="uc-confirm-popup-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>

          <button
            type="button"
            className={`uc-confirm-popup-confirm ${popup.danger ? 'danger' : 'primary'}`}
            onClick={onConfirm}
          >
            {popup.confirmLabel || 'Confirm'}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function InlineActionMessage({ feedback, onClose, className = '' }) {
  if (!feedback) {
    return null;
  }

  return (
    <div
      className={`uc-inline-feedback ${feedback.type || 'info'} ${className}`.trim()}
      role="status"
    >
      <div className="uc-inline-feedback-icon">
        {feedback.loading ? (
          <Loader2 size={15} className="uc-popup-spin" />
        ) : feedback.type === 'success' ? (
          <CheckCircle2 size={15} />
        ) : feedback.type === 'error' || feedback.type === 'warning' ? (
          <AlertTriangle size={15} />
        ) : (
          <ShieldCheck size={15} />
        )}
      </div>

      <div className="uc-inline-feedback-copy">
        {feedback.title ? <strong>{feedback.title}</strong> : null}
        <span>{feedback.message}</span>
      </div>

      <button
        type="button"
        className="uc-inline-feedback-close"
        onClick={onClose}
        aria-label="Dismiss message"
      >
        <X size={13} />
      </button>
    </div>
  );
}

function ProfilePhotoInput({ state, setState, mode = 'create', alerts }) {
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
      alerts?.warning?.('Please choose an image file.', 'Invalid Photo File');
      return;
    }

    if (file.size > 1024 * 1024 * 2) {
      alerts?.warning?.('Image size should be below 2MB.', 'Photo Too Large');
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
  const [confirmPopup, setConfirmPopup] = useState(null);
  const confirmResolverRef = useRef(null);
  const [inlineFeedback, setInlineFeedback] = useState({});
  const inlineFeedbackTimersRef = useRef({});

  const [rows, setRows] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [form, setForm] = useState({ ...USER_CREATE_TEMPLATE });
  const [q, setQ] = useState('');
  const [tenant, setTenant] = useState('');
  const [designationFilter, setDesignationFilter] = useState('');
  const [edit, setEdit] = useState(null);
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
  const [tableSearch, setTableSearch] = useState('');
  const [tablePage, setTablePage] = useState(1);
  const [tablePageSize, setTablePageSize] = useState(DEFAULT_USER_TABLE_PAGE_SIZE);

  function clearInlineFeedback(scope) {
    if (!scope) {
      return;
    }

    const timer = inlineFeedbackTimersRef.current[scope];

    if (timer) {
      window.clearTimeout(timer);
      delete inlineFeedbackTimersRef.current[scope];
    }

    setInlineFeedback((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, scope)) {
        return prev;
      }

      const next = { ...prev };
      delete next[scope];
      return next;
    });
  }

  function showInlineFeedback(scope, type, message, title = '', options = {}) {
    if (!scope) {
      return;
    }

    const existingTimer = inlineFeedbackTimersRef.current[scope];

    if (existingTimer) {
      window.clearTimeout(existingTimer);
      delete inlineFeedbackTimersRef.current[scope];
    }

    setInlineFeedback((prev) => ({
      ...prev,
      [scope]: {
        type,
        title,
        message,
        loading: Boolean(options.loading),
      },
    }));

    if (!options.loading) {
      inlineFeedbackTimersRef.current[scope] = window.setTimeout(() => {
        setInlineFeedback((prev) => {
          const next = { ...prev };
          delete next[scope];
          return next;
        });
        delete inlineFeedbackTimersRef.current[scope];
      }, USER_POPUP_AUTO_HIDE_MS);
    }
  }

  function scopedAlerts(scope) {
    return {
      success: (message, title = 'Success') =>
        showInlineFeedback(scope, 'success', message, title),
      error: (message, title = 'Error') =>
        showInlineFeedback(scope, 'error', message, title),
      warning: (message, title = 'Warning') =>
        showInlineFeedback(scope, 'warning', message, title),
      info: (message, title = 'Information') =>
        showInlineFeedback(scope, 'info', message, title),
      loading: (message, title = 'Please Wait') =>
        showInlineFeedback(scope, 'info', message, title, { loading: true }),
    };
  }

  function resolveConfirm(result = false) {
    const resolver = confirmResolverRef.current;

    confirmResolverRef.current = null;
    setConfirmPopup(null);

    if (resolver) {
      resolver(Boolean(result));
    }
  }

  function showConfirm(message, title = 'Please Confirm', options = {}) {
    return new Promise((resolve) => {
      if (confirmResolverRef.current) {
        confirmResolverRef.current(false);
      }

      confirmResolverRef.current = resolve;

      const normalizedTitle = String(title || '').replace(/\?+$/, '');

      setConfirmPopup({
        title,
        message,
        danger: options.danger !== false,
        confirmLabel: options.confirmLabel || normalizedTitle || 'Confirm',
      });
    });
  }

  const alerts = scopedAlerts('page');

  useEffect(() => {
    return () => {
      Object.values(inlineFeedbackTimersRef.current).forEach((timer) => {
        window.clearTimeout(timer);
      });
      inlineFeedbackTimersRef.current = {};
    };
  }, []);

  useEffect(() => {
    if (!confirmPopup || typeof document === 'undefined') {
      return undefined;
    }

    const body = document.body;
    const root = document.documentElement;
    const previousBodyOverflow = body.style.overflow;
    const previousRootOverflow = root.style.overflow;
    const previousBodyOverscroll = body.style.overscrollBehavior;
    const previousRootOverscroll = root.style.overscrollBehavior;

    body.style.overflow = 'hidden';
    root.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
    root.style.overscrollBehavior = 'none';

    const blockBackgroundScroll = (event) => {
      const activePopup = document.querySelector('.uc-confirm-popup-card');

      if (activePopup && activePopup.contains(event.target)) {
        return;
      }

      event.preventDefault();
    };

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        resolveConfirm(false);
      }
    };

    document.addEventListener('wheel', blockBackgroundScroll, { passive: false });
    document.addEventListener('touchmove', blockBackgroundScroll, { passive: false });
    window.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('wheel', blockBackgroundScroll);
      document.removeEventListener('touchmove', blockBackgroundScroll);
      window.removeEventListener('keydown', handleEscape);

      body.style.overflow = previousBodyOverflow;
      root.style.overflow = previousRootOverflow;
      body.style.overscrollBehavior = previousBodyOverscroll;
      root.style.overscrollBehavior = previousRootOverscroll;
    };
  }, [confirmPopup]);

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

        const selectedTenant = await loadTenants();
        await loadHelperOptions(selectedTenant);
        await load(selectedTenant);
      } catch (error) {
        console.error(error);
        scopedAlerts('search').error(error.message || 'Unable to load users', 'Users Load Failed');
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
    const actionAlerts = scopedAlerts('search');

    try {
      actionAlerts.loading('Searching tenant users with the selected filters...', 'Searching Users');

      const items = await load(tenant);
      await loadHelperOptions(tenant);

      actionAlerts.success(
        `Search complete — ${items.length} ${items.length === 1 ? 'user' : 'users'} found.`,
        'Search Complete',
      );
    } catch (error) {
      actionAlerts.error(error.message || 'Unable to search users', 'User Search Failed');
    }
  }

  async function clearSearch() {
    const actionAlerts = scopedAlerts('search');

    setQ('');
    setDesignationFilter('');

    try {
      actionAlerts.loading('Clearing filters and loading the full tenant user list...', 'Clearing Search');

      const data = await getSuperAdminTenantUsers({ tenant_id: tenant });
      setRows(data.items || []);
      await loadHelperOptions(tenant);

      actionAlerts.success('Search filters were cleared successfully.', 'Search Cleared');
    } catch (error) {
      actionAlerts.error(error.message || 'Unable to clear search', 'Clear Search Failed');
    }
  }

  async function handleTenantChange(nextTenant) {
    const cleanTenant = String(nextTenant || '').trim();

    setTenant(cleanTenant);
    setQ('');
    setDesignationFilter('');
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
      scopedAlerts('search').error(error.message || 'Unable to load selected tenant users', 'Tenant Users Load Failed');
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

    const actionAlerts = scopedAlerts('create');
    const payload = cleanUserPayload(form);
    const validationMessage = validateUserPayload(payload, 'create');

    if (validationMessage) {
      actionAlerts.warning(validationMessage, 'Required Details Missing');
      return;
    }

    try {
      setSaving(true);
      actionAlerts.loading('Creating the employee and linked login user...', 'Creating Employee');

      const data = await createSuperAdminTenantEmployee(payload);

      actionAlerts.success(data.message || 'Employee created successfully', 'Employee Created');
      resetCreateForm(payload.tenant_id);
      await load(payload.tenant_id);
      await loadHelperOptions(payload.tenant_id);
    } catch (error) {
      actionAlerts.error(error.message || 'Unable to create employee', 'Employee Create Failed');
    } finally {
      setSaving(false);
    }
  }

  async function openEdit(user) {
    try {

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
      scopedAlerts(`user:${user?._id || 'unknown'}`).error(error.message || 'Unable to open edit form', 'Edit Open Failed');
    }
  }

  async function save(e) {
    e.preventDefault();

    const formAlerts = scopedAlerts('edit');

    const payload = cleanUserPayload(edit);
    const validationMessage = validateUserPayload(payload, 'edit');

    if (validationMessage) {
      formAlerts.warning(validationMessage, 'Required Details Missing');
      return;
    }

    if (payload.password && payload.password !== payload.confirm_password && payload.confirm_password) {
      formAlerts.warning('Password and confirm password do not match', 'Password Mismatch');
      return;
    }

    const editUserId = edit?.user_id_for_edit;
    const ok = await showConfirm(
      `Save the updated profile for ${edit?.name || edit?.email || 'this user'}?`,
      'Save Profile?',
      {
        danger: false,
        confirmLabel: 'Save Changes',
      },
    );

    if (!ok) {
      return;
    }

    const actionAlerts = scopedAlerts(`user:${editUserId}:edit`);

    try {
      setSaving(true);
      actionAlerts.loading('Saving the updated user and employee profile...', 'Saving User');

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

      const data = await api(`/superadmin/users/${editUserId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });

      actionAlerts.success(data.message || 'User/profile updated successfully', 'User Updated');
      setEdit(null);
      await load(payload.tenant_id);
      await loadHelperOptions(payload.tenant_id);
    } catch (error) {
      actionAlerts.error(error.message || 'Unable to save user', 'User Save Failed');
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

    const formAlerts = scopedAlerts('password');

    if (!resetTarget?._id) {
      formAlerts.warning('No user selected for password reset', 'Select User');
      return;
    }

    if (!resetForm.password || resetForm.password.length < 6) {
      formAlerts.warning('Password must be at least 6 characters', 'Password Too Short');
      return;
    }

    if (resetForm.password !== resetForm.confirm_password) {
      formAlerts.warning('Password and confirm password do not match', 'Password Mismatch');
      return;
    }

    const resetUserId = resetTarget._id;
    const ok = await showConfirm(
      `Reset the password for ${resetTarget.name || resetTarget.email || 'this user'}?`,
      'Reset Password?',
      {
        danger: false,
        confirmLabel: 'Reset Password',
      },
    );

    if (!ok) {
      return;
    }

    const actionAlerts = scopedAlerts(`user:${resetUserId}:password`);

    try {
      setSaving(true);
      actionAlerts.loading('Updating the selected user password...', 'Updating Password');

      const data = await changeSuperAdminTenantUserPassword(resetUserId, resetForm);

      actionAlerts.success(data.message || 'Password updated successfully', 'Password Updated');
      setResetTarget(null);
      setResetForm({
        password: '',
        confirm_password: '',
      });
    } catch (error) {
      actionAlerts.error(error.message || 'Unable to reset password', 'Password Reset Failed');
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
    const actionAlerts = scopedAlerts(`user:${user._id}`);

    const ok = await showConfirm(
      `Are you sure you want to ${action} ${user.name || user.email || 'this user'}?`,
      isActive ? 'Disable User?' : 'Enable User?',
      {
        danger: isActive,
        confirmLabel: isActive ? 'Disable User' : 'Enable User',
      },
    );

    if (!ok) {
      return;
    }

    try {
      setSaving(true);
      actionAlerts.loading(
        isActive ? 'Disabling the selected user...' : 'Enabling the selected user...',
        isActive ? 'Disabling User' : 'Enabling User',
      );

      const data = await updateSuperAdminTenantUserStatus(user._id, {
        is_active: !isActive,
      });

      actionAlerts.success(
        data.message || (isActive ? 'User disabled successfully' : 'User enabled successfully'),
        isActive ? 'User Disabled' : 'User Enabled',
      );
      await load(tenant);
    } catch (error) {
      actionAlerts.error(error.message || 'Unable to update user status', 'Status Update Failed');
    } finally {
      setSaving(false);
    }
  }

  async function deleteUser(user) {
    if (!user?._id) {
      return;
    }

    const ok = await showConfirm(
      `Delete ${user.name || user.email || 'this user'} from the active database list?`,
      'Delete User?',
      {
        danger: true,
        confirmLabel: 'Delete User',
      },
    );

    if (!ok) {
      return;
    }

    const actionAlerts = scopedAlerts('table');

    try {
      setSaving(true);
      actionAlerts.loading('Deleting the selected user from the active database list...', 'Deleting User');

      const data = await deleteSuperAdminTenantUser(user._id);

      actionAlerts.success(data.message || 'User deleted successfully', 'User Deleted');
      await load(tenant);
      await loadHelperOptions(tenant);
    } catch (error) {
      actionAlerts.error(error.message || 'Unable to delete user', 'User Delete Failed');
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
      return <ProfilePhotoInput key={key} state={state} setState={setState} mode={mode} alerts={scopedAlerts(mode === 'edit' ? 'edit' : 'create')} />;
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

  const tableSearchText = tableSearch.trim().toLowerCase();

  const filteredTableRows = tableSearchText
    ? rows.filter((user) => {
        const searchableValues = [
          userDisplayName(user),
          user.email,
          user.tenant_id,
          employeeIdValue(user),
          displayRoles(user.roles),
          employeeDepartmentValue(user),
          employeeDesignationValue(user),
          employeeStateValue(user),
          employeeTeamLeaderName(user),
          employeeReportingOfficerName(user),
          employeeIsTeamLeader(user),
          employeeIsReportingOfficer(user),
          employeeIsItSupportHead(user),
          employeeIsItSupportMember(user),
          user.is_active !== false && user.is_disabled !== true ? 'active' : 'disabled',
        ];

        return searchableValues.some((value) =>
          String(value ?? '').toLowerCase().includes(tableSearchText),
        );
      })
    : rows;

  const tablePageCount = Math.max(
    1,
    Math.ceil(filteredTableRows.length / tablePageSize),
  );

  const currentTablePage = Math.min(tablePage, tablePageCount);
  const tableStartIndex = (currentTablePage - 1) * tablePageSize;
  const tableRows = filteredTableRows.slice(
    tableStartIndex,
    tableStartIndex + tablePageSize,
  );

  const tablePageNumbers = (() => {
    if (tablePageCount <= 7) {
      return Array.from({ length: tablePageCount }, (_, index) => index + 1);
    }

    const pageNumbers = [1];
    const startPage = Math.max(2, currentTablePage - 1);
    const endPage = Math.min(tablePageCount - 1, currentTablePage + 1);

    if (startPage > 2) {
      pageNumbers.push('left-ellipsis');
    }

    for (let pageNumber = startPage; pageNumber <= endPage; pageNumber += 1) {
      pageNumbers.push(pageNumber);
    }

    if (endPage < tablePageCount - 1) {
      pageNumbers.push('right-ellipsis');
    }

    pageNumbers.push(tablePageCount);
    return pageNumbers;
  })();

  return (
    <div className="page-grid user-control-page superadmin-user-control">
      <style>{`
        .user-control-page {
          --uc-ink: #101a3a;
          --uc-muted: #5d6d8d;
          --uc-primary: #6658dc;
          --uc-primary-deep: #40348d;
          --uc-cyan: #18b5c8;
          --uc-border: rgba(16, 26, 58, .14);
          --uc-ease: cubic-bezier(.22, 1, .36, 1);

          display: grid;
          gap: clamp(18px, 2vw, 26px);
          width: 100%;
          min-width: 0;
          max-width: 100%;
          padding-bottom: max(34px, env(safe-area-inset-bottom));
          color: var(--uc-ink);
          font-family: var(--yc-ui, var(--body), inherit);
        }

        .user-control-page *,
        .user-control-page *::before,
        .user-control-page *::after {
          box-sizing: border-box;
        }

        .user-control-page > *,
        .user-control-page .panel,
        .user-control-page .toolbar,
        .user-control-page .dynamic-form,
        .user-control-page .uc-tenant-grid,
        .user-control-page .uc-table-tools,
        .user-control-page .table-wrap {
          width: 100%;
          min-width: 0;
          max-width: 100%;
        }

        .user-control-page img,
        .user-control-page input,
        .user-control-page select,
        .user-control-page textarea,
        .user-control-page button {
          max-width: 100%;
        }

        .user-control-page > .hero {
          position: relative;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 28px;
          min-height: 250px;
          padding: clamp(26px, 3vw, 42px);
          border: 1px solid rgba(154, 164, 205, .58);
          border-radius: clamp(28px, 2.7vw, 40px);
          background: linear-gradient(
            90deg,
            #d3f4fb 0%,
            #f7fcfb 34%,
            #fffdf8 52%,
            #fbf8fa 68%,
            #f0edfb 100%
          );
          box-shadow:
            12px 14px 0 #c6d8f7,
            0 28px 48px rgba(34, 38, 110, .13);
        }

        .user-control-page > .hero::before,
        .user-control-page > .hero::after {
          content: none;
          display: none;
        }

        .user-control-page > .hero > div {
          min-width: 0;
          max-width: 950px;
        }

        .user-control-page .kicker {
          display: inline-flex;
          align-items: center;
          width: fit-content;
          max-width: 100%;
          padding: 9px 13px;
          border-radius: 999px;
          color: #fff;
          background: linear-gradient(135deg, #4c76dc 0%, #2db6b7 100%);
          box-shadow: 4px 5px 0 #595192;
          font-size: 9px;
          font-weight: 950;
          line-height: 1;
          letter-spacing: .12em;
          text-transform: uppercase;
        }

        .user-control-page > .hero h1 {
          margin: 15px 0 10px;
          color: var(--uc-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(42px, 5vw, 74px);
          font-weight: 760;
          line-height: .94;
          letter-spacing: -.056em;
          overflow-wrap: anywhere;
        }

        .user-control-page > .hero p {
          max-width: 880px;
          margin: 0;
          color: var(--uc-muted);
          font-size: clamp(13px, 1vw, 16px);
          line-height: 1.68;
        }

        .user-control-page > .panel {
          overflow: hidden;
          border: 1px solid rgba(171, 181, 211, .70);
          border-radius: clamp(26px, 2.2vw, 36px);
          background: linear-gradient(145deg, #ffffff, #f7fbff);
          box-shadow:
            8px 10px 0 #c4ccff,
            0 24px 42px rgba(34, 38, 110, .10);
        }

        .user-control-page .toolbar {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 18px;
          padding: 24px 26px 18px;
          border-bottom: 1px solid rgba(171, 181, 211, .38);
          background: linear-gradient(180deg, rgba(245, 248, 255, .84), rgba(255,255,255,.28));
        }

        .user-control-page .toolbar > div {
          min-width: 0;
        }

        .user-control-page .toolbar h3 {
          margin: 0;
          color: var(--uc-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(25px, 2.3vw, 37px);
          font-weight: 760;
          line-height: 1;
          letter-spacing: -.045em;
          overflow-wrap: anywhere;
        }

        .user-control-page .toolbar p {
          max-width: 850px;
          margin: 8px 0 0;
          color: var(--uc-muted);
          font-size: 13px;
          line-height: 1.58;
        }

        .user-control-page button,
        .user-control-page .uc-file-btn {
          touch-action: manipulation;
          font: inherit;
          font-weight: 900;
          cursor: pointer;
          transition:
            transform 190ms var(--uc-ease),
            box-shadow 190ms ease,
            background 190ms ease,
            border-color 190ms ease,
            color 190ms ease,
            filter 190ms ease;
        }

        .user-control-page button:hover:not(:disabled):not(.uc-warning-soft):not(.uc-danger-soft),
        .user-control-page .uc-file-btn:hover {
          transform: translateY(-2px);
          filter: saturate(1.04);
        }

        .user-control-page button:active:not(:disabled),
        .user-control-page .uc-file-btn:active {
          transform: translateY(0) scale(.985);
        }

        .user-control-page button:disabled {
          cursor: not-allowed;
          opacity: .52;
          transform: none;
          filter: none;
        }

        .user-control-page .primary,
        .user-control-page .secondary,
        .user-control-page .danger,
        .user-control-page .uc-tenant-grid > button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-height: 47px;
          padding: 0 16px;
          border-radius: 15px;
          line-height: 1;
          white-space: nowrap;
        }

.user-control-page
.primary:not(.uc-create-employee-button):not(.uc-save-changes-button):not(.uc-update-password-button),
.user-control-page
.uc-tenant-grid > button:not(.secondary):not(.uc-user-search-button) {
  border: 1px solid rgba(52, 43, 120, .16);
  color: #fff;
  background: linear-gradient(135deg, #342b78, #4f65d7 58%, #18b5c8);
  box-shadow:
    5px 6px 0 #a9d6f5,
    0 14px 25px rgba(36, 74, 128, .16);
}

.user-control-page .uc-create-employee-button,
.user-control-page .uc-user-search-button,
.user-control-page .uc-save-changes-button,
.user-control-page .uc-update-password-button {
  border: 1px solid rgba(76, 118, 220, .18);
  color: #fff;
  background: linear-gradient(135deg, #4c76dc 0%, #2db6b7 100%);
  box-shadow:
    6px 7px 0 #595192,
    0 14px 25px rgba(67, 116, 170, .16);
}

        .user-control-page .secondary {
          border: 1px solid rgba(65, 55, 161, .18);
          color: #40348d;
          background: rgba(255,255,255,.94);
          box-shadow: 3px 4px 0 rgba(52, 43, 120, .10);
        }

        .user-control-page .danger {
          border: 1px solid rgba(190, 47, 85, .18);
          color: #b62f55;
          background: #fff0f2;
          box-shadow: 3px 4px 0 #f2c2cc;
        }

        .user-control-page .uc-warning-soft {
          color: #9a6817 !important;
          background: #fff4d5 !important;
          border-color: rgba(154, 104, 23, .18) !important;
          box-shadow: 3px 4px 0 #ffe0a5 !important;
        }

        .user-control-page .uc-success-soft {
  color: #fff !important;
  background: linear-gradient(135deg, #4c76dc 0%, #2db6b7 100%) !important;
  border-color: rgba(76, 118, 220, .18) !important;
  box-shadow:
    6px 7px 0 #595192,
    0 14px 25px rgba(67, 116, 170, .16) !important;
}

        .user-control-page .uc-danger-soft {
          color: #a2344d !important;
          background: #fff0f2 !important;
          border-color: rgba(162, 52, 77, .18) !important;
          box-shadow: 3px 4px 0 #f2c2cc !important;
        }

        .user-control-page .uc-tenant-grid {
          display: grid;
          grid-template-columns:
            minmax(220px, 1.2fr)
            minmax(210px, 1fr)
            minmax(190px, .9fr)
            auto
            auto;
          gap: 12px;
          align-items: end;
          padding: 20px 26px 22px;
          border-bottom: 1px solid rgba(171, 181, 211, .38);
          background: rgba(255,255,255,.68);
        }

        .user-control-page label {
          display: grid;
          gap: 8px;
          min-width: 0;
          margin: 0;
          color: #303b5b;
          font-size: 11px;
          font-weight: 900;
        }

        .user-control-page label small,
        .user-control-page .uc-photo-controls small {
          color: var(--uc-muted);
          font-size: 10px;
          font-weight: 650;
          line-height: 1.55;
        }

        .user-control-page input,
        .user-control-page select,
        .user-control-page textarea {
          width: 100%;
          min-width: 0;
          min-height: 47px;
          padding: 0 13px;
          border: 1px solid rgba(151, 161, 197, .58);
          border-radius: 15px;
          outline: 0;
          color: var(--uc-ink);
          background: rgba(255,255,255,.96);
          font: inherit;
          font-weight: 650;
          transition:
            border-color 170ms ease,
            box-shadow 170ms ease,
            transform 170ms ease,
            background 170ms ease;
        }

        .user-control-page textarea {
          min-height: 110px;
          padding: 13px;
          resize: vertical;
        }

        .user-control-page input:focus,
        .user-control-page select:focus,
        .user-control-page textarea:focus {
          border-color: rgba(102,88,220,.65);
          box-shadow:
            4px 5px 0 rgba(102,88,220,.14),
            0 0 0 4px rgba(102,88,220,.08);
          transform: translateY(-1px);
        }

        .user-control-page input:disabled,
        .user-control-page select:disabled,
        .user-control-page textarea:disabled,
        .user-control-page input[readonly] {
          color: #667085;
          background: #f4f6fa;
        }

        .user-control-page .dynamic-form {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 15px;
          align-items: start;
          padding: 24px 26px 28px;
          border-bottom: 1px solid rgba(171, 181, 211, .38);
          background: linear-gradient(180deg, rgba(248,250,255,.72), rgba(255,255,255,.78));
        }

        .user-control-page .dynamic-form > .toolbar {
          grid-column: 1 / -1 !important;
          width: 100%;
          margin: 0 0 2px;
          padding: 0 0 15px !important;
          border: 0;
          border-bottom: 1px solid rgba(171,181,211,.30);
          background: transparent;
        }

        .user-control-page .dynamic-form > button {
          align-self: end;
          min-height: 47px;
        }

        .user-control-page .uc-photo-field {
          grid-column: 1 / -1;
        }

        .user-control-page .uc-photo-box {
          display: grid;
          grid-template-columns: 96px minmax(0, 1fr);
          gap: 16px;
          align-items: center;
          min-width: 0;
          margin-top: 2px;
          padding: 15px;
          border: 1px solid rgba(171, 181, 211, .50);
          border-radius: 20px;
          background: linear-gradient(145deg, #edf6ff, #f8f7ff);
          box-shadow: 4px 5px 0 rgba(185,215,255,.55);
        }

        .user-control-page .uc-photo-preview {
          display: grid;
          place-items: center;
          width: 88px;
          height: 88px;
          overflow: hidden;
          border: 3px solid #fff;
          border-radius: 24px;
          color: #40348d;
          background: linear-gradient(145deg, #eef9ff, #f1efff);
          box-shadow: 0 14px 30px rgba(34,38,110,.12);
          font-size: 24px;
          font-weight: 900;
        }

        .user-control-page .uc-photo-preview img,
        .user-control-page .uc-avatar img {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .user-control-page .uc-photo-controls {
          display: grid;
          gap: 10px;
          min-width: 0;
        }

        .user-control-page .uc-photo-actions {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }

        .user-control-page .uc-file-btn {
          display: inline-flex !important;
          align-items: center;
          justify-content: center;
          gap: 8px;
          width: auto !important;
          min-height: 43px;
          margin: 0 !important;
          padding: 0 14px;
          border: 1px solid rgba(102,88,220,.18);
          border-radius: 13px;
          color: #40348d;
          background: #f1efff;
          box-shadow: 3px 4px 0 #c9c0ff;
        }

        .user-control-page .uc-file-btn input {
          display: none;
        }

        .user-control-page .uc-avatar {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex: 0 0 auto;
          overflow: hidden;
          border: 2px solid #fff;
          border-radius: 999px;
          color: #40348d;
          background: linear-gradient(145deg, #eef9ff, #f1efff);
          box-shadow: 0 10px 22px rgba(15,23,42,.12);
          font-weight: 900;
        }

        .user-control-page .uc-avatar-sm {
          width: 38px;
          height: 38px;
          font-size: 12px;
        }

        .user-control-page .uc-avatar-md {
          width: 52px;
          height: 52px;
          font-size: 15px;
        }

        .user-control-page .uc-user-cell {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 190px;
        }

        .user-control-page .uc-user-cell > div {
          min-width: 0;
        }

        .user-control-page .uc-user-cell strong {
          display: block;
          color: var(--uc-ink);
          font-size: 13px;
          font-weight: 950;
          overflow-wrap: anywhere;
        }

        .user-control-page .uc-user-cell small {
          display: block;
          margin-top: 3px;
          color: var(--uc-muted);
          font-size: 10px;
          overflow-wrap: anywhere;
        }

        .user-control-page .uc-table-tools {
          display: grid;
          grid-template-columns: minmax(280px, 1fr) auto auto;
          gap: 16px;
          align-items: end;
          padding: 18px 24px;
          border-top: 1px solid rgba(171,181,211,.36);
          border-bottom: 1px solid rgba(171,181,211,.42);
          background: rgba(248,250,255,.84);
        }

        .user-control-page .uc-table-search {
          position: relative;
          min-width: 0;
        }

        .user-control-page .uc-table-search > svg {
          position: absolute;
          top: 50%;
          left: 14px;
          transform: translateY(-50%);
          color: var(--uc-primary);
          pointer-events: none;
        }

        .user-control-page .uc-table-search input {
          padding-left: 43px;
          background: #fff;
        }

        .user-control-page .uc-table-summary {
          display: flex;
          align-items: baseline;
          gap: 6px;
          min-height: 47px;
          padding: 0 4px;
          white-space: nowrap;
        }

        .user-control-page .uc-table-summary strong {
          color: var(--uc-ink);
          font-family: Georgia, "Times New Roman", serif;
          font-size: 27px;
          line-height: 1;
        }

        .user-control-page .uc-table-summary span {
          color: var(--uc-muted);
          font-size: 11px;
          font-weight: 850;
        }

        .user-control-page .uc-page-size {
          display: grid;
          grid-template-columns: auto 86px;
          align-items: center;
          gap: 8px;
          min-width: 0;
          color: var(--uc-muted);
          font-size: 10px;
          font-weight: 900;
          white-space: nowrap;
        }

        .user-control-page .uc-page-size select {
          min-height: 42px;
          padding: 0 30px 0 11px;
          border-radius: 13px;
          color: #40348d;
          background: #fff;
          font-weight: 900;
        }

        .user-control-page .uc-user-data-board {
          display: grid;
          gap: 15px;
          min-width: 0;
          padding: 18px 24px 22px;
          background:
            linear-gradient(180deg, rgba(255,255,255,.96), rgba(247,250,255,.86));
        }

        .user-control-page .uc-user-record-card {
          display: grid;
          gap: 0;
          min-width: 0;
          overflow: hidden;
          border: 1px solid rgba(171,181,211,.58);
          border-radius: 22px;
          background: #fff;
          box-shadow:
            5px 6px 0 rgba(196,204,255,.78),
            0 16px 30px rgba(34,38,110,.07);
          transition:
            transform 190ms var(--uc-ease),
            box-shadow 190ms ease,
            border-color 190ms ease;
        }

        .user-control-page .uc-user-record-card:hover {
          transform: translateY(-2px);
          border-color: rgba(102,88,220,.28);
          box-shadow:
            6px 8px 0 rgba(196,204,255,.9),
            0 20px 34px rgba(34,38,110,.09);
        }

        .user-control-page .uc-record-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          min-width: 0;
          padding: 17px 18px;
          border-bottom: 1px solid rgba(171,181,211,.34);
          background:
            linear-gradient(135deg, rgba(237,246,255,.92), rgba(248,247,255,.92));
        }

        .user-control-page .uc-record-head .uc-user-cell {
          min-width: 0;
        }

        .user-control-page .uc-record-code {
          display: inline-block;
          margin-top: 5px;
          color: #536381;
          font-size: 9px;
          font-weight: 900;
          letter-spacing: .04em;
          text-transform: uppercase;
        }

        .user-control-page .uc-record-head-badges {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 9px;
          flex-wrap: wrap;
          min-width: 0;
        }

        .user-control-page .uc-tenant-chip {
          display: inline-flex;
          align-items: center;
          min-height: 30px;
          max-width: 220px;
          padding: 6px 10px;
          overflow: hidden;
          border-radius: 999px;
          color: #40348d;
          background: #f1efff;
          box-shadow: 2px 3px 0 #c9c0ff;
          font-size: 10px;
          font-weight: 900;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .user-control-page .uc-record-grid {
          display: grid;
          grid-template-columns:
            minmax(0, 1.18fr)
            minmax(0, 1fr)
            minmax(0, 1.08fr);
          gap: 12px;
          padding: 15px 18px 17px;
        }

        .user-control-page .uc-record-block {
          display: grid;
          align-content: start;
          gap: 11px;
          min-width: 0;
          padding: 14px;
          border: 1px solid rgba(171,181,211,.42);
          border-radius: 17px;
          background: #f9fbff;
        }

        .user-control-page .uc-record-block:nth-child(2) {
          background: #f8f7ff;
        }

        .user-control-page .uc-record-block:nth-child(3) {
          background: #f4fbf8;
        }

        .user-control-page .uc-record-kicker {
          color: #5d6785;
          font-size: 8px;
          font-weight: 950;
          letter-spacing: .085em;
          text-transform: uppercase;
        }

        .user-control-page .uc-record-pairs {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }

        .user-control-page .uc-record-pairs.compact {
          grid-template-columns: 1fr;
        }

        .user-control-page .uc-record-pairs > div,
        .user-control-page .uc-capability-grid > div {
          min-width: 0;
        }

        .user-control-page .uc-record-pairs span,
        .user-control-page .uc-capability-grid span {
          display: block;
          color: #6b7692;
          font-size: 8px;
          font-weight: 900;
          letter-spacing: .05em;
          text-transform: uppercase;
        }

        .user-control-page .uc-record-pairs strong {
          display: block;
          margin-top: 4px;
          color: var(--uc-ink);
          font-size: 11px;
          line-height: 1.42;
          overflow-wrap: anywhere;
        }

        .user-control-page .uc-capability-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }

        .user-control-page .uc-capability-grid > div {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 9px 10px;
          border: 1px solid rgba(171,181,211,.38);
          border-radius: 13px;
          background: rgba(255,255,255,.84);
        }

        .user-control-page .uc-capability-pill {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex: 0 0 auto;
          min-width: 38px;
          min-height: 25px;
          padding: 4px 8px;
          border-radius: 999px;
          font-size: 9px;
          font-weight: 950;
        }

        .user-control-page .uc-capability-pill.yes {
          color: #047857;
          background: #eaf8f4;
          box-shadow: 2px 2px 0 #aee6d9;
        }

        .user-control-page .uc-capability-pill.no {
          color: #667085;
          background: #eef1f6;
          box-shadow: 2px 2px 0 #d9dfe9;
        }

        .user-control-page .uc-status-pill {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: max-content;
          min-height: 30px;
          padding: 6px 10px;
          border-radius: 999px;
          font-size: 10px;
          font-weight: 900;
          white-space: nowrap;
        }

        .user-control-page .uc-status-pill.active {
          color: #047857;
          background: #eaf8f4;
          box-shadow: 2px 3px 0 #aee6d9;
        }

        .user-control-page .uc-status-pill.disabled {
          color: #a2344d;
          background: #fff0f2;
          box-shadow: 2px 3px 0 #f2c2cc;
        }

        .user-control-page .uc-record-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 14px 18px 17px;
          border-top: 1px solid rgba(171,181,211,.34);
          background: rgba(250,251,255,.84);
        }

        .user-control-page .uc-record-footnote {
          min-width: 0;
        }

        .user-control-page .uc-record-footnote span {
          display: block;
          color: #6b7692;
          font-size: 8px;
          font-weight: 950;
          letter-spacing: .07em;
          text-transform: uppercase;
        }

        .user-control-page .uc-record-footnote strong {
          display: block;
          margin-top: 3px;
          color: var(--uc-ink);
          font-size: 11px;
          overflow-wrap: anywhere;
        }

        .user-control-page .uc-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          flex-wrap: wrap;
          gap: 8px;
          min-width: 0;
        }

        .user-control-page .uc-actions button {
          min-height: 36px;
          padding: 0 11px;
          font-size: 10px;
          white-space: nowrap;
        }

        .user-control-page .empty {
          padding: 38px 20px;
          border: 1px dashed rgba(102,88,220,.28);
          border-radius: 18px;
          color: var(--uc-muted);
          background: linear-gradient(145deg, #f8f7ff, #effbf8);
          font-size: 13px;
          font-weight: 800;
          text-align: center;
        }

        .user-control-page .uc-table-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 17px 24px 21px;
          border-top: 1px solid rgba(171,181,211,.38);
          background: rgba(248,250,255,.86);
        }

        .user-control-page .uc-table-range {
          display: flex;
          align-items: baseline;
          gap: 5px;
          min-width: 0;
          color: var(--uc-muted);
          font-size: 10px;
          font-weight: 800;
          white-space: nowrap;
        }

        .user-control-page .uc-table-range strong {
          color: var(--uc-ink);
          font-size: 12px;
        }

        .user-control-page .uc-table-pagination {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          min-width: 0;
        }

        .user-control-page .uc-page-numbers {
          display: flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
        }

        .user-control-page .uc-page-arrow,
        .user-control-page .uc-page-number {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          min-width: 40px;
          height: 40px;
          padding: 0;
          border: 1px solid rgba(102,88,220,.20);
          border-radius: 12px;
          color: #40348d;
          background: #f1efff;
          box-shadow: 2px 3px 0 #c9c0ff;
        }

        .user-control-page .uc-page-number.active {
          border-color: rgba(76,118,220,.22);
          color: #fff;
          background: linear-gradient(135deg, #4c76dc 0%, #2db6b7 100%);
          box-shadow: 4px 5px 0 #595192;
        }

        .user-control-page .uc-page-ellipsis {
          display: inline-grid;
          min-width: 18px;
          place-items: center;
          color: var(--uc-muted);
          font-weight: 900;
        }

        .uc-confirm-popup-backdrop {
          position: fixed;
          inset: 0;
          z-index: 12000;
          display: grid;
          place-items: center;
          width: 100vw;
          height: 100dvh;
          overflow: hidden;
          padding:
            max(18px, env(safe-area-inset-top))
            max(18px, env(safe-area-inset-right))
            max(18px, env(safe-area-inset-bottom))
            max(18px, env(safe-area-inset-left));
          background: rgba(15, 23, 42, .58);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          overscroll-behavior: none;
        }

        .uc-confirm-popup-card {
          width: min(540px, calc(100vw - 36px));
          overflow: hidden;
          border: 1px solid rgba(171, 181, 211, .74);
          border-radius: 26px;
          background: linear-gradient(145deg, #ffffff 0%, #f7fbff 55%, #f8f4ff 100%);
          box-shadow:
            0 32px 86px rgba(22, 29, 73, .32),
            9px 11px 0 rgba(185, 215, 255, .46);
        }

        .uc-confirm-popup-head {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          gap: 13px;
          align-items: center;
          padding: 19px 20px 16px;
          border-bottom: 1px solid rgba(171, 181, 211, .42);
          background: linear-gradient(135deg, rgba(237,246,255,.97), rgba(248,247,255,.98));
        }

        .uc-confirm-popup-icon {
          display: grid;
          place-items: center;
          width: 44px;
          height: 44px;
          border-radius: 14px;
          color: #40348d;
          background: #f1efff;
          box-shadow: 3px 4px 0 #c9c0ff;
        }

        .uc-confirm-popup-icon.danger {
          color: #a2344d;
          background: #fff0f2;
          box-shadow: 3px 4px 0 #f2c2cc;
        }

        .uc-confirm-popup-title {
          min-width: 0;
        }

        .uc-confirm-popup-title > span {
          display: block;
          color: #6b7692;
          font-size: 8px;
          font-weight: 950;
          letter-spacing: .09em;
          text-transform: uppercase;
        }

        .uc-confirm-popup-title h3 {
          margin: 4px 0 0;
          color: #101a3a;
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: 22px;
          font-weight: 760;
          line-height: 1.08;
          letter-spacing: -.025em;
          overflow-wrap: anywhere;
        }

        .uc-confirm-popup-close {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 38px;
          min-width: 38px;
          height: 38px;
          padding: 0;
          border: 1px solid rgba(65, 55, 161, .18);
          border-radius: 12px;
          color: #40348d;
          background: #fff;
          box-shadow: 3px 4px 0 rgba(52,43,120,.10);
        }

        .uc-confirm-popup-body {
          padding: 19px 20px 20px;
        }

        .uc-confirm-popup-body p {
          margin: 0;
          color: #4f5f7d;
          font-size: 12px;
          font-weight: 700;
          line-height: 1.62;
          overflow-wrap: anywhere;
        }

        .uc-confirm-popup-actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          padding: 15px 20px 20px;
          border-top: 1px solid rgba(171, 181, 211, .38);
          background: rgba(248, 250, 255, .90);
        }

        .uc-confirm-popup-actions button,
        .uc-confirm-popup-confirm {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 43px;
          width: 100%;
          padding: 0 14px;
          border-radius: 13px;
          font: inherit;
          font-size: 11px;
          font-weight: 900;
        }

        .uc-confirm-popup-actions .secondary {
          border: 1px solid rgba(65, 55, 161, .18);
          color: #40348d;
          background: #fff;
          box-shadow: 3px 4px 0 rgba(52,43,120,.10);
        }

       .uc-confirm-popup-confirm.primary {
  border: 1px solid rgba(76, 118, 220, .18);
  color: #fff;
  background: linear-gradient(135deg, #4c76dc 0%, #2db6b7 100%);
  box-shadow:
    6px 7px 0 #595192,
    0 14px 25px rgba(67, 116, 170, .16);
}

        .uc-confirm-popup-confirm.danger {
          border: 1px solid rgba(162, 52, 77, .22);
          color: #fff;
          background: linear-gradient(135deg, #a2344d, #d4576f);
          box-shadow: 4px 5px 0 #efb4c1;
        }

        .uc-confirm-popup-card.is-danger,
.uc-confirm-popup-card.is-danger:hover {
  transform: none !important;
  filter: none !important;
  transition: none !important;
}

.uc-confirm-popup-card.is-danger .uc-confirm-popup-close:hover {
  transform: none !important;
  filter: none !important;
  transition: none !important;
  border: 1px solid rgba(65, 55, 161, .18);
  color: #40348d;
  background: #fff;
  box-shadow: 3px 4px 0 rgba(52,43,120,.10);
}

.uc-confirm-popup-card.is-danger .uc-confirm-popup-actions .secondary:hover {
  transform: none !important;
  filter: none !important;
  transition: none !important;
  border: 1px solid rgba(65, 55, 161, .18);
  color: #40348d;
  background: #fff;
  box-shadow: 3px 4px 0 rgba(52,43,120,.10);
}

.uc-confirm-popup-card.is-danger .uc-confirm-popup-confirm.danger:hover {
  transform: none !important;
  filter: none !important;
  transition: none !important;
  border: 1px solid rgba(162, 52, 77, .22);
  color: #fff;
  background: linear-gradient(135deg, #a2344d, #d4576f);
  box-shadow: 4px 5px 0 #efb4c1;
}

        .uc-inline-feedback {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          gap: 9px;
          align-items: start;
          width: 100%;
          min-width: 0;
          padding: 10px 11px;
          border: 1px solid rgba(102,88,220,.18);
          border-radius: 12px;
          color: #40348d;
          background: #f1efff;
          box-shadow: 3px 4px 0 #c9c0ff;
          font-size: 10px;
          line-height: 1.45;
        }

        .uc-inline-feedback.success {
          border-color: rgba(4,120,87,.18);
          color: #047857;
          background: #eaf8f4;
          box-shadow: 3px 4px 0 #aee6d9;
        }

        .uc-inline-feedback.warning {
          border-color: rgba(154,104,23,.18);
          color: #9a6817;
          background: #fff4d5;
          box-shadow: 3px 4px 0 #ffe0a5;
        }

        .uc-inline-feedback.error {
          border-color: rgba(162,52,77,.18);
          color: #a2344d;
          background: #fff0f2;
          box-shadow: 3px 4px 0 #f2c2cc;
        }

        .uc-inline-feedback-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          flex: 0 0 22px;
        }

        .uc-inline-feedback-copy {
          min-width: 0;
        }

        .uc-inline-feedback-copy strong,
        .uc-inline-feedback-copy span {
          display: block;
          overflow-wrap: anywhere;
        }

        .uc-inline-feedback-copy strong {
          margin-bottom: 2px;
          font-size: 10px;
          font-weight: 950;
        }

        .uc-inline-feedback-copy span {
          font-weight: 750;
        }

        .uc-inline-feedback-close {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          min-width: 24px;
          height: 24px;
          margin: -2px -3px -2px 0;
          padding: 0;
          border: 0;
          border-radius: 8px;
          color: currentColor;
          background: rgba(255,255,255,.52);
          box-shadow: none;
          opacity: .72;
        }

        .uc-inline-feedback-close:hover {
          transform: none !important;
          filter: none !important;
          opacity: 1;
          background: rgba(255,255,255,.92);
        }

        .uc-popup-spin {
          animation: ucPopupSpin .8s linear infinite;
        }

        @keyframes ucPopupSpin {
          to { transform: rotate(360deg); }
        }

        .uc-search-inline-feedback {
          grid-column: 4 / -1;
        }

        .uc-form-action-stack,
        .uc-record-action-stack {
          display: grid;
          gap: 9px;
          min-width: 0;
        }

        .uc-form-action-stack {
          align-self: end;
        }

        .uc-record-action-stack {
          width: fit-content;
          max-width: min(760px, 100%);
          justify-self: end;
          justify-items: stretch;
        }

        .uc-record-action-feedback {
          width: 100%;
          min-width: 0;
          max-width: 100%;
        }

        .uc-table-inline-feedback {
          margin: 0 24px 16px;
        }

        #user-edit-section,
        #password-reset-section {
          scroll-margin-top: 20px;
        }

        #user-edit-section .dynamic-form,
        #password-reset-section .dynamic-form {
          border-bottom: 0;
        }

        @media (max-width: 1280px) {
          .user-control-page .dynamic-form {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .user-control-page .uc-tenant-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .user-control-page .uc-tenant-grid > button {
            width: 100%;
          }

          .user-control-page .uc-table-tools {
            grid-template-columns: minmax(240px, 1fr) auto auto;
          }

          .user-control-page .uc-record-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .user-control-page .uc-record-block:last-child {
            grid-column: 1 / -1;
          }

          .user-control-page .uc-record-pairs.compact {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 1050px) {
          .user-control-page > .hero {
            align-items: flex-start;
            flex-direction: column;
            min-height: 0;
          }

          .user-control-page .toolbar {
            align-items: stretch;
            flex-direction: column;
          }

          .user-control-page .toolbar > .secondary {
            align-self: flex-start;
          }
        }

        @media (max-width: 820px) {
          .user-control-page {
            gap: 18px;
          }

          .user-control-page > .hero {
            padding: 26px;
          }

          .user-control-page > .hero h1 {
            font-size: clamp(38px, 8vw, 58px);
          }

          .user-control-page .uc-tenant-grid {
            grid-template-columns: 1fr;
          }

          .user-control-page .dynamic-form {
            grid-template-columns: 1fr;
          }

          .user-control-page .toolbar,
          .user-control-page .uc-tenant-grid,
          .user-control-page .dynamic-form,
          .user-control-page .uc-table-tools {
            padding-left: 20px;
            padding-right: 20px;
          }

          .user-control-page .uc-table-tools {
            grid-template-columns: 1fr auto;
          }

          .user-control-page .uc-table-search {
            grid-column: 1 / -1;
          }

          .user-control-page .uc-table-summary {
            justify-content: flex-start;
          }

          .user-control-page .uc-page-size {
            justify-self: end;
          }

          .user-control-page .uc-user-data-board {
            display: flex;
            gap: 14px;
            overflow-x: auto;
            overflow-y: hidden;
            padding: 18px 20px 24px;
            scroll-snap-type: x mandatory;
            overscroll-behavior-x: contain;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: thin;
            scrollbar-color: rgba(102,88,220,.26) transparent;
          }

          .user-control-page .uc-user-record-card {
            flex: 0 0 min(88vw, 560px);
            scroll-snap-align: start;
            scroll-snap-stop: always;
          }

          .user-control-page .uc-record-grid {
            grid-template-columns: 1fr;
          }

          .user-control-page .uc-record-block:last-child {
            grid-column: auto;
          }

          .user-control-page .uc-record-pairs.compact {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .user-control-page .uc-table-footer {
            align-items: stretch;
            flex-direction: column;
            padding-left: 20px;
            padding-right: 20px;
          }

          .user-control-page .uc-table-pagination {
            justify-content: flex-start;
          }

          .user-control-page .uc-page-numbers {
            max-width: 100%;
            overflow-x: auto;
            padding: 2px 0 4px;
            scrollbar-width: none;
          }

          .user-control-page .uc-page-numbers::-webkit-scrollbar {
            display: none;
          }
        }

        @media (max-width: 680px) {
          .user-control-page {
            gap: 15px;
          }

          .user-control-page > .hero {
            padding: 22px 18px;
            border-radius: 26px;
            box-shadow:
              7px 9px 0 #c6d8f7,
              0 20px 34px rgba(34,38,110,.11);
          }

          .user-control-page > .hero h1 {
            font-size: clamp(34px, 12vw, 50px);
          }

          .user-control-page > .hero p {
            font-size: 12px;
          }

          .user-control-page > .panel {
            border-radius: 22px;
            box-shadow:
              5px 7px 0 #c4ccff,
              0 18px 30px rgba(34,38,110,.09);
          }

          .user-control-page .toolbar {
            padding: 18px 17px 15px;
          }

          .user-control-page .uc-tenant-grid {
            padding: 16px 17px 18px;
          }

          .user-control-page .dynamic-form {
            padding: 18px 17px 20px;
          }

          .user-control-page .dynamic-form > .toolbar {
            padding-bottom: 14px !important;
          }

          .user-control-page .dynamic-form > button,
          .user-control-page .toolbar > .secondary,
          .user-control-page .uc-tenant-grid > button {
            width: 100%;
          }

          .user-control-page .uc-photo-box {
            grid-template-columns: 1fr;
          }

          .user-control-page .uc-photo-preview {
            width: 78px;
            height: 78px;
          }

          .user-control-page .uc-table-tools {
            grid-template-columns: 1fr;
            padding: 15px 17px;
          }

          .user-control-page .uc-table-search {
            grid-column: auto;
          }

          .user-control-page .uc-page-size {
            grid-template-columns: 1fr 88px;
            justify-self: stretch;
          }

          .user-control-page .uc-user-data-board {
            padding: 15px 17px 22px;
          }

          .user-control-page .uc-user-record-card {
            flex-basis: calc(100vw - 58px);
          }

          .user-control-page .uc-record-head,
          .user-control-page .uc-record-footer {
            align-items: stretch;
            flex-direction: column;
          }

          .user-control-page .uc-record-head-badges {
            justify-content: flex-start;
          }

          .user-control-page .uc-record-pairs,
          .user-control-page .uc-record-pairs.compact,
          .user-control-page .uc-capability-grid {
            grid-template-columns: 1fr;
          }

          .user-control-page .uc-table-footer {
            padding: 15px 17px 19px;
          }

          .user-control-page .uc-table-pagination {
            width: 100%;
            justify-content: space-between;
          }

          .user-control-page .uc-page-numbers {
            flex: 1 1 auto;
            justify-content: center;
          }

          .user-control-page .uc-actions {
            width: 100%;
            justify-content: stretch;
          }

          .user-control-page .uc-actions button {
            flex: 1 1 calc(50% - 8px);
          }
        }

        @media (max-width: 520px) {
          .user-control-page > .hero {
            padding: 20px 15px;
          }

          .user-control-page > .hero h1 {
            font-size: clamp(31px, 11vw, 43px);
          }

          .user-control-page .kicker {
            max-width: 100%;
            white-space: normal;
          }

          .user-control-page .toolbar h3 {
            font-size: 25px;
          }

          .user-control-page .uc-file-btn,
          .user-control-page .uc-photo-actions .secondary {
            width: 100% !important;
          }

          .user-control-page .uc-page-arrow,
          .user-control-page .uc-page-number {
            width: 38px;
            min-width: 38px;
            height: 38px;
          }

          .user-control-page .uc-user-record-card {
            flex-basis: calc(100vw - 44px);
          }

          .user-control-page .uc-actions {
            display: grid;
            grid-template-columns: 1fr;
          }

          .user-control-page .uc-actions button {
            width: 100%;
          }


          .uc-confirm-popup-backdrop {
            padding:
              max(10px, env(safe-area-inset-top))
              max(10px, env(safe-area-inset-right))
              max(10px, env(safe-area-inset-bottom))
              max(10px, env(safe-area-inset-left));
          }

          .uc-confirm-popup-card {
            width: calc(100vw - 20px);
            border-radius: 22px;
            box-shadow:
              0 24px 60px rgba(22,29,73,.28),
              6px 7px 0 rgba(185,215,255,.40);
          }

          .uc-confirm-popup-head {
            gap: 10px;
            padding: 15px;
          }

          .uc-confirm-popup-icon {
            width: 39px;
            height: 39px;
          }

          .uc-confirm-popup-title h3 {
            font-size: 19px;
          }

          .uc-confirm-popup-body {
            padding: 16px 15px 17px;
          }

          .uc-confirm-popup-actions {
            padding: 13px 15px 16px;
          }

          .uc-search-inline-feedback {
            grid-column: 1 / -1;
          }

          .uc-record-action-stack {
            width: 100%;
            max-width: none;
            justify-self: stretch;
            justify-items: stretch;
          }

          .uc-record-action-feedback {
            width: 100%;
          }

          .uc-table-inline-feedback {
            margin-left: 17px;
            margin-right: 17px;
          }
        }

        @media (max-width: 380px) {
          .user-control-page {
            gap: 13px;
          }

          .user-control-page > .hero {
            padding: 18px 13px;
          }

          .user-control-page .toolbar,
          .user-control-page .uc-tenant-grid,
          .user-control-page .dynamic-form,
          .user-control-page .uc-table-tools,
          .user-control-page .uc-table-footer {
            padding-left: 13px;
            padding-right: 13px;
          }

          .user-control-page .uc-user-data-board {
            padding-left: 13px;
            padding-right: 13px;
          }

          .user-control-page .uc-user-record-card {
            flex-basis: calc(100vw - 36px);
          }

          .user-control-page .uc-page-arrow,
          .user-control-page .uc-page-number {
            width: 35px;
            min-width: 35px;
            height: 35px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .user-control-page *,
          .user-control-page *::before,
          .user-control-page *::after {
            scroll-behavior: auto !important;
            animation-duration: .01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: .01ms !important;
          }
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

          <button
            type="button"
            className="uc-user-search-button"
            onClick={searchUsers}
            disabled={loading || !tenant}
          >
            <Search size={16} /> {loading ? 'Searching...' : 'Search'}
          </button>

          <button type="button" className="secondary" onClick={clearSearch} disabled={loading || !tenant}>
            <RefreshCw size={16} /> Clear
          </button>

          <InlineActionMessage
            feedback={inlineFeedback.search || inlineFeedback.page}
            onClose={() => {
              clearInlineFeedback('search');
              clearInlineFeedback('page');
            }}
            className="uc-search-inline-feedback"
          />
        </div>

        <form className="dynamic-form" onSubmit={create}>
          <div className="toolbar" style={{ gridColumn: '1 / -1', padding: 0 }}>
            <div>
              <h3>Create Employee</h3>
              <p>Create employee and login user under the selected tenant.</p>
            </div>
          </div>

          {CREATE_FIELD_ORDER.map((key) => renderCreateField(key))}

          <div className="uc-form-action-stack">
            <button
              type="submit"
              className="primary uc-create-employee-button"
              disabled={saving || !form.tenant_id}
            >
              <Plus size={16} /> {saving ? 'Creating...' : 'Create Employee'}
            </button>

            <InlineActionMessage
              feedback={inlineFeedback.create}
              onClose={() => clearInlineFeedback('create')}
            />
          </div>
        </form>


        <div className="uc-table-tools">
          <div className="uc-table-search">
            <Search size={17} />
            <input
              type="search"
              value={tableSearch}
              onChange={(event) => {
                setTableSearch(event.target.value);
                setTablePage(1);
              }}
              placeholder="Search within this user table"
              aria-label="Search within this user table"
            />
          </div>

          <div className="uc-table-summary">
            <strong>{filteredTableRows.length.toLocaleString('en-IN')}</strong>
            <span>{filteredTableRows.length === 1 ? 'user' : 'users'}</span>
          </div>

          <label className="uc-page-size">
            <span>Rows per page</span>
            <select
              value={tablePageSize}
              onChange={(event) => {
                setTablePageSize(Number(event.target.value));
                setTablePage(1);
              }}
              aria-label="Rows per page"
            >
              {USER_TABLE_PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="uc-user-data-board">
          {tableRows.map((user) => {
            const isActive = user.is_active !== false && user.is_disabled !== true;
            const isTeamLeader = employeeIsTeamLeader(user);
            const isReportingOfficer = employeeIsReportingOfficer(user);
            const isItSupportHead = employeeIsItSupportHead(user);
            const isItSupportMember = employeeIsItSupportMember(user);

            return (
              <article className="uc-user-record-card" key={user._id}>
                <header className="uc-record-head">
                  <div className="uc-user-cell">
                    <UserAvatar user={user} size="md" />
                    <div>
                      <strong>{textValue(user.name || user.employee_name)}</strong>
                      <small>{textValue(user.email)}</small>
                      <span className="uc-record-code">{employeeIdValue(user)}</span>
                    </div>
                  </div>

                  <div className="uc-record-head-badges">
                    <span className="uc-tenant-chip">{textValue(user.tenant_id)}</span>
                    <span className={`uc-status-pill ${isActive ? 'active' : 'disabled'}`}>
                      {isActive ? 'Active' : 'Disabled'}
                    </span>
                  </div>
                </header>

                <div className="uc-record-grid">
                  <section className="uc-record-block">
                    <span className="uc-record-kicker">Access & organisation</span>

                    <div className="uc-record-pairs">
                      <div>
                        <span>Login Access</span>
                        <strong>{displayRoles(user.roles)}</strong>
                      </div>
                      <div>
                        <span>Department</span>
                        <strong>{employeeDepartmentValue(user)}</strong>
                      </div>
                      <div>
                        <span>Designation</span>
                        <strong>{employeeDesignationValue(user)}</strong>
                      </div>
                      <div>
                        <span>State</span>
                        <strong>{employeeStateValue(user)}</strong>
                      </div>
                    </div>
                  </section>

                  <section className="uc-record-block">
                    <span className="uc-record-kicker">Capabilities</span>

                    <div className="uc-capability-grid">
                      <div>
                        <span>Team Leader</span>
                        <strong className={`uc-capability-pill ${isTeamLeader === 'Yes' ? 'yes' : 'no'}`}>
                          {isTeamLeader}
                        </strong>
                      </div>
                      <div>
                        <span>Reporting Officer</span>
                        <strong className={`uc-capability-pill ${isReportingOfficer === 'Yes' ? 'yes' : 'no'}`}>
                          {isReportingOfficer}
                        </strong>
                      </div>
                      <div>
                        <span>IT Support Head</span>
                        <strong className={`uc-capability-pill ${isItSupportHead === 'Yes' ? 'yes' : 'no'}`}>
                          {isItSupportHead}
                        </strong>
                      </div>
                      <div>
                        <span>IT Support Member</span>
                        <strong className={`uc-capability-pill ${isItSupportMember === 'Yes' ? 'yes' : 'no'}`}>
                          {isItSupportMember}
                        </strong>
                      </div>
                    </div>
                  </section>

                  <section className="uc-record-block">
                    <span className="uc-record-kicker">Reporting map</span>

                    <div className="uc-record-pairs compact">
                      <div>
                        <span>Mapped Team Leader</span>
                        <strong>{employeeTeamLeaderName(user)}</strong>
                      </div>
                      <div>
                        <span>Mapped Reporting Officer</span>
                        <strong>{employeeReportingOfficerName(user)}</strong>
                      </div>
                      <div>
                        <span>Employee ID / Code</span>
                        <strong>{employeeIdValue(user)}</strong>
                      </div>
                      <div>
                        <span>Email</span>
                        <strong>{textValue(user.email)}</strong>
                      </div>
                    </div>
                  </section>
                </div>

                <footer className="uc-record-footer">
                  <div className="uc-record-footnote">
                    <span>User control</span>
                    <strong>{textValue(user.name || user.employee_name)}</strong>
                  </div>

                  <div className="uc-record-action-stack">
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

                      <button
                        type="button"
                        className="danger uc-danger-soft"
                        onClick={() => deleteUser(user)}
                        disabled={saving}
                      >
                        <Trash2 size={15} /> Delete
                      </button>
                    </div>

                    <InlineActionMessage
                      feedback={inlineFeedback[`user:${user._id}:edit`]}
                      onClose={() => clearInlineFeedback(`user:${user._id}:edit`)}
                      className="uc-record-action-feedback"
                    />

                    <InlineActionMessage
                      feedback={inlineFeedback[`user:${user._id}:password`]}
                      onClose={() => clearInlineFeedback(`user:${user._id}:password`)}
                      className="uc-record-action-feedback"
                    />

                    <InlineActionMessage
                      feedback={inlineFeedback[`user:${user._id}`]}
                      onClose={() => clearInlineFeedback(`user:${user._id}`)}
                      className="uc-record-action-feedback"
                    />
                  </div>
                </footer>
              </article>
            );
          })}

          {!filteredTableRows.length && (
            <div className="empty">
              {loading
                ? 'Loading users...'
                : tableSearch
                  ? 'No users match the current table search'
                  : tenant
                    ? 'No users found for this tenant'
                    : 'Please select a tenant'}
            </div>
          )}
        </div>

        <InlineActionMessage
          feedback={inlineFeedback.table}
          onClose={() => clearInlineFeedback('table')}
          className="uc-table-inline-feedback"
        />

        <div className="uc-table-footer">
          <div className="uc-table-range">
            <span>Showing</span>
            <strong>
              {filteredTableRows.length
                ? `${tableStartIndex + 1}–${Math.min(tableStartIndex + tablePageSize, filteredTableRows.length)}`
                : '0–0'}
            </strong>
            <span>of {filteredTableRows.length.toLocaleString('en-IN')}</span>
          </div>

          <div className="uc-table-pagination" aria-label="User table pagination">
            <button
              type="button"
              className="uc-page-arrow"
              onClick={() => setTablePage(Math.max(1, currentTablePage - 1))}
              disabled={currentTablePage <= 1}
              aria-label="Previous user table page"
            >
              ‹
            </button>

            <div className="uc-page-numbers">
              {tablePageNumbers.map((item) =>
                typeof item === 'number' ? (
                  <button
                    type="button"
                    key={item}
                    className={`uc-page-number ${item === currentTablePage ? 'active' : ''}`}
                    onClick={() => setTablePage(item)}
                    aria-current={item === currentTablePage ? 'page' : undefined}
                  >
                    {item}
                  </button>
                ) : (
                  <span className="uc-page-ellipsis" key={item}>…</span>
                ),
              )}
            </div>

            <button
              type="button"
              className="uc-page-arrow"
              onClick={() => setTablePage(Math.min(tablePageCount, currentTablePage + 1))}
              disabled={currentTablePage >= tablePageCount}
              aria-label="Next user table page"
            >
              ›
            </button>
          </div>
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

            <div className="uc-form-action-stack">
              <button type="submit" className="primary uc-save-changes-button" disabled={saving}>
  <Save size={16} /> {saving ? 'Saving...' : 'Save Changes'}
</button>

              <InlineActionMessage
                feedback={inlineFeedback.edit}
                onClose={() => clearInlineFeedback('edit')}
              />
            </div>
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

            <div className="uc-form-action-stack">
<button type="submit" className="primary uc-update-password-button" disabled={saving}>
  <KeyRound size={16} /> {saving ? 'Updating...' : 'Update Password'}
</button>

              <InlineActionMessage
                feedback={inlineFeedback.password}
                onClose={() => clearInlineFeedback('password')}
              />
            </div>
          </form>
        </section>
      )}

      <UserControlConfirmPopup
        popup={confirmPopup}
        onClose={() => resolveConfirm(false)}
        onConfirm={() => resolveConfirm(true)}
      />
    </div>
  );
}
