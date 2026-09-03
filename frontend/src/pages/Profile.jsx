import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Building2,
  Camera,
  CheckCircle2,
  ImagePlus,
  KeyRound,
  Mail,
  MapPin,
  Pencil,
  Phone,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
} from 'lucide-react';
import {
  currentUser,
  currentEmployee,
  api,
  getInitials,
  getProfilePhotoUrl,
  getProfileCoverUrl,
  refreshCurrentSession,
  buildProfilePhotoPayload,
  buildProfileCoverPayload,
  uploadEmployeeProfilePhoto,
  uploadEmployeeProfileCover,
} from '../api/client';
import { useCustomAlert } from '../components/CustomAlertProvider.jsx';
import { getDisplayRole, getEmployeeCapabilities } from '../data/modules';

function normalizeRoles(user) {
  const userRoles = user?.roles;

  if (Array.isArray(userRoles)) {
    return userRoles
      .map((role) => String(role || '').trim())
      .filter(Boolean);
  }

  if (typeof userRoles === 'string') {
    return userRoles
      .split(',')
      .map((role) => role.trim())
      .filter(Boolean);
  }

  const singleRole = String(user?.role || '').trim();

  return singleRole ? [singleRole] : [];
}

function displayValue(value) {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  if (Array.isArray(value)) {
    return value.join(', ') || '—';
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  return String(value);
}

function boolLabel(value) {
  const normalized = String(value || '').toLowerCase();

  if (['true', 'yes', '1', 'on'].includes(normalized)) {
    return 'Yes';
  }

  return 'No';
}

function roleLabel(role = '') {
  const normalized = String(role || '').trim();

  if (normalized === 'team_leader') {
    return 'Team Leader Capability';
  }

  if (normalized === 'reporting_officer') {
    return 'Reporting Officer Capability';
  }

  if (normalized === 'ro' || normalized === 'manager') {
    return 'Reporting Officer Capability';
  }

  return normalized
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function companyNameFromPayload(data = {}, user = {}, employee = {}) {
  const branding = data.branding || data.tenant_branding || {};
  const tenant = data.tenant || data.company || user.tenant || user.company || {};
  const nestedBranding = tenant.branding || {};

  return firstValue(
    branding.company_name,
    branding.name,
    tenant.company_name,
    tenant.name,
    tenant.tenant_name,
    nestedBranding.company_name,
    user.company_name,
    user.tenant_name,
    employee.company_name,
    employee.organisation_name,
    employee.organization_name,
    employee.organisation,
    employee.organization,
  );
}

function profileCapabilityItems(user = {}, employee = {}) {
  const capabilities = getEmployeeCapabilities({
    ...(user || {}),
    employee: employee || {},
    employee_profile: employee || {},
  });
  const items = [];

  if (capabilities.isTeamLeader) {
    items.push('Team Leader');
  }

  if (capabilities.isReportingOfficer) {
    items.push('Reporting Officer');
  }

  if (capabilities.isHrAdmin) {
    items.push('HR Records');
  }

  if (capabilities.isItSupportHead) {
    items.push('IT Support Head');
  } else if (capabilities.isItSupportMember) {
    items.push('IT Support Member');
  }

  return items;
}

function firstValue(...values) {
  for (const value of values) {
    const cleaned = String(value ?? '').trim();

    if (cleaned) {
      return cleaned;
    }
  }

  return '';
}

function titleCase(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function capabilityTitle(employee = {}, roles = []) {
  if (
    boolLabel(employee.is_team_leader) === 'Yes' ||
    roles.includes('team_leader')
  ) {
    return 'Team Leader';
  }

  if (
    boolLabel(employee.is_reporting_officer) === 'Yes' ||
    roles.includes('reporting_officer') ||
    roles.includes('manager') ||
    roles.includes('ro')
  ) {
    return 'Reporting Officer';
  }

  if (boolLabel(employee.is_it_support_head) === 'Yes') {
    return 'IT Support Head';
  }

  if (boolLabel(employee.is_it_support_member) === 'Yes') {
    return 'IT Support Member';
  }

  const nonEmployeeRole = roles.find((role) => !['employee'].includes(String(role || '').toLowerCase()));

  return nonEmployeeRole ? roleLabel(nonEmployeeRole) : '';
}

function profileDesignationLine(employee = {}, roles = []) {
  const designation = titleCase(firstValue(
    employee.designation,
    employee.designation_name,
    employee.job_title,
    employee.title,
    employee.position,
    'Employee',
  ));
  const department = titleCase(firstValue(
    employee.department,
    employee.department_name,
    employee.team,
  ));
  const capability = capabilityTitle(employee, roles);

  if (designation && department && capability) {
    return `${designation} ${department} - ${capability}`;
  }

  if (designation && department) {
    return `${designation} ${department}`;
  }

  if (designation && capability) {
    return `${designation} - ${capability}`;
  }

  return designation || capability || 'Employee';
}

function isUnsafeMediaValue(value = '') {
  const media = String(value || '').trim();

  if (!media) {
    return false;
  }

  if (media.startsWith('data:image') && media.length > 5000) {
    return true;
  }

  if (media.length > 1000 && !media.startsWith('http')) {
    return true;
  }

  return false;
}

function cleanMediaValue(value = '') {
  const media = String(value || '').trim();

  if (!media || isUnsafeMediaValue(media)) {
    return '';
  }

  return media;
}

function profilePhotoValue(record = {}) {
  return (
    cleanMediaValue(record.avatar) ||
    cleanMediaValue(record.profile_photo) ||
    cleanMediaValue(record.profile_picture) ||
    cleanMediaValue(record.photo) ||
    cleanMediaValue(record.image) ||
    cleanMediaValue(record.picture) ||
    cleanMediaValue(record.employee_avatar) ||
    cleanMediaValue(record.employee_profile_photo) ||
    cleanMediaValue(record.profile_photo_url) ||
    cleanMediaValue(record.avatar_url) ||
    cleanMediaValue(record.photo_url) ||
    ''
  );
}

function profileCoverValue(record = {}) {
  return (
    cleanMediaValue(record.cover_image) ||
    cleanMediaValue(record.cover_photo) ||
    cleanMediaValue(record.profile_cover) ||
    cleanMediaValue(record.profile_cover_image) ||
    cleanMediaValue(record.banner_image) ||
    cleanMediaValue(record.banner_photo) ||
    cleanMediaValue(record.employee_cover_image) ||
    cleanMediaValue(record.employee_cover_photo) ||
    cleanMediaValue(record.cover_url) ||
    cleanMediaValue(record.profile_cover_url) ||
    cleanMediaValue(record.banner_url) ||
    ''
  );
}

function employeeId(employee = {}) {
  return employee._id || employee.id || employee.employee_id_for_edit || employee.employee_ref_id || '';
}

function mergeNonEmpty(base = {}, incoming = {}) {
  const merged = { ...(base || {}) };

  Object.entries(incoming || {}).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') {
      merged[key] = value;
    }
  });

  return merged;
}

const PROFILE_MEDIA_FIELDS = [
  'avatar',
  'profile_photo',
  'profile_picture',
  'photo',
  'image',
  'picture',
  'employee_avatar',
  'employee_profile_photo',
  'profile_photo_url',
  'avatar_url',
  'photo_url',

  'cover_image',
  'cover_photo',
  'profile_cover',
  'profile_cover_image',
  'banner_image',
  'banner_photo',
  'employee_cover_image',
  'employee_cover_photo',
  'cover_url',
  'profile_cover_url',
  'banner_url',
];

function mergeProfileState(base = {}, incoming = {}) {
  const merged = mergeNonEmpty(base, incoming);

  PROFILE_MEDIA_FIELDS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(incoming || {}, key)) {
      merged[key] = incoming[key] ?? '';
    }
  });

  return merged;
}

function extractEmployeePayload(response) {
  if (!response || typeof response !== 'object') {
    return null;
  }

  return response.employee || response.item || response.data || response;
}

function buildEditForm(user = {}, employee = {}) {
  return {
    name: firstValue(
      employee.employee_name,
      employee.name,
      employee.full_name,
      user.name,
      user.full_name,
    ),
    phone: firstValue(
      employee.phone,
      employee.mobile,
      employee.contact,
      employee.contact_number,
    ),
    personal_email: firstValue(
      employee.personal_email,
      employee.alternate_email,
    ),
    gender: firstValue(employee.gender, employee.sex),
    date_of_birth: firstValue(employee.date_of_birth, employee.dob),
    marital_status: firstValue(employee.marital_status),
    blood_group: firstValue(employee.blood_group),
    current_address: firstValue(employee.current_address, employee.address),
    permanent_address: firstValue(employee.permanent_address),
    college: firstValue(employee.college),
    school: firstValue(employee.school),
    qualification: firstValue(employee.qualification, employee.education),
    emergency_contact_name: firstValue(
      employee.emergency_contact_name,
      employee.emergency_contact_person,
    ),
    emergency_contact_number: firstValue(
      employee.emergency_contact_number,
      employee.emergency_phone,
    ),
  };
}

function buildEmployeeProfileUpdatePayload(form = {}) {
  const name = String(form.name || '').trim();
  const phone = String(form.phone || '').trim();
  const dateOfBirth = String(form.date_of_birth || '').trim();
  const currentAddress = String(form.current_address || '').trim();
  const qualification = String(form.qualification || '').trim();
  const emergencyName = String(form.emergency_contact_name || '').trim();
  const emergencyNumber = String(form.emergency_contact_number || '').trim();

  return {
    name,
    employee_name: name,
    full_name: name,
    display_name: name,

    phone,
    mobile: phone,
    contact: phone,
    contact_number: phone,

    personal_email: String(form.personal_email || '').trim(),
    alternate_email: String(form.personal_email || '').trim(),

    gender: String(form.gender || '').trim(),
    sex: String(form.gender || '').trim(),

    date_of_birth: dateOfBirth,
    dob: dateOfBirth,

    marital_status: String(form.marital_status || '').trim(),
    blood_group: String(form.blood_group || '').trim(),

    current_address: currentAddress,
    address: currentAddress,
    permanent_address: String(form.permanent_address || '').trim(),

    college: String(form.college || '').trim(),
    school: String(form.school || '').trim(),
    qualification,
    education: qualification,

    emergency_contact_name: emergencyName,
    emergency_contact_person: emergencyName,
    emergency_contact_number: emergencyNumber,
    emergency_phone: emergencyNumber,
  };
}

function validateImageFile(file, maxMb, alerts, label) {
  if (!file) {
    return false;
  }

  if (!file.type.startsWith('image/')) {
    alerts.warning(`Please choose a valid ${label}.`, 'Invalid File');
    return false;
  }

  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

  if (!allowedTypes.includes(file.type.toLowerCase())) {
    alerts.warning('Only JPG, JPEG, PNG, and WEBP images are allowed.', 'Unsupported Image');
    return false;
  }

  if (file.size > 1024 * 1024 * maxMb) {
    alerts.warning(`${label} size should be below ${maxMb}MB.`, 'File Too Large');
    return false;
  }

  return true;
}

function EditIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 20h4.4L19.7 8.7a2.1 2.1 0 0 0 0-3L18.3 4.3a2.1 2.1 0 0 0-3 0L4 15.6V20Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="m13.7 5.9 4.4 4.4" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 6h16v12H4V6Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="m4 7 8 6 8-6" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6.6 3.8 9.8 7c.7.7.7 1.8.1 2.5l-1 1.2a13.4 13.4 0 0 0 4.4 4.4l1.2-1c.7-.6 1.8-.6 2.5.1l3.2 3.2c.7.7.7 1.8 0 2.5l-1.4 1.4c-.8.8-2 .9-3 .4A23.8 23.8 0 0 1 2.3 8.2c-.5-1-.4-2.2.4-3L4.1 3.8c.7-.7 1.8-.7 2.5 0Z"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

function DetailValue({ label, value }) {
  return (
    <div className="profile-field">
      <span>{label}</span>
      <strong>{displayValue(value)}</strong>
    </div>
  );
}

function ProfileSection({ title, rows, onEdit }) {
  const visibleRows = rows.filter(([label]) => label);

  return (
    <section className="profile-info-card">
      <div className="profile-section-head">
        <div className="profile-section-title">
          <UserRound size={15} />
          <h3>{title}</h3>
        </div>

        {onEdit ? (
          <button type="button" className="profile-edit-mini" onClick={onEdit}>
            <EditIcon />
            Edit
          </button>
        ) : null}
      </div>

      <div className="profile-field-grid">
        {visibleRows.map(([label, value]) => (
          <DetailValue label={label} value={value} key={label} />
        ))}
      </div>
    </section>
  );
}

export default function Profile() {
  const alerts = useCustomAlert();

  const [user, setUser] = useState(currentUser());
  const [employee, setEmployee] = useState(currentEmployee());
  const [hydrating, setHydrating] = useState(true);
  const [companyName, setCompanyName] = useState(() =>
    companyNameFromPayload({}, currentUser(), currentEmployee()),
  );

  const userRoles = normalizeRoles(user);
  const initialPhoto = profilePhotoValue(employee) || profilePhotoValue(user);
  const initialCover = profileCoverValue(employee) || profileCoverValue(user);

  const [photo, setPhoto] = useState(initialPhoto);
  const [cover, setCover] = useState(initialCover);

  const [photoSaving, setPhotoSaving] = useState(false);
  const [coverSaving, setCoverSaving] = useState(false);

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState(() => buildEditForm(user, employee));
  const [profileSaving, setProfileSaving] = useState(false);

  const [form, setForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  });

  const [submitting, setSubmitting] = useState(false);

  const mainName = firstValue(
    user.name,
    user.full_name,
    employee.employee_name,
    employee.name,
    employee.full_name,
    user.email,
    'My Profile',
  );

  const displayName = firstValue(
    employee.display_name,
    user.display_name,
    user.full_name,
    employee.employee_name,
    mainName,
  );

  const mainRole = profileDesignationLine(employee, userRoles);
  const dashboardRole = getDisplayRole({
    ...(user || {}),
    employee: employee || {},
    employee_profile: employee || {},
  });
  const capabilityItems = profileCapabilityItems(user, employee);
  const capabilitySummary = capabilityItems.length
    ? capabilityItems.join(' + ')
    : 'No additional capability';
  const loginAccess = userRoles.length
    ? userRoles.map(roleLabel).join(', ')
    : dashboardRole;
  const dashboardIdentity = capabilityItems.length
    ? `${dashboardRole} • ${capabilityItems.join(' + ')}`
    : dashboardRole;

  const previewPhotoUrl = photo ? getProfilePhotoUrl({ avatar: photo }) : '';
  const previewCoverUrl = cover ? getProfileCoverUrl({ cover_image: cover }) : '';

  useEffect(() => {
    let isMounted = true;

    async function loadLatestProfile() {
      setHydrating(true);

      try {
        const sessionData = await refreshCurrentSession();

        if (!isMounted) {
          return;
        }

        const sessionUser = sessionData?.user
          ? mergeProfileState(user, sessionData.user)
          : user;

        const sessionEmployee = sessionData?.employee
          ? mergeProfileState(employee, sessionData.employee)
          : employee;

        setUser(sessionUser);
        setEmployee(sessionEmployee);

        const empId = employeeId(sessionEmployee);

        if (empId) {
          try {
            const fullResponse = await api(`/employees/${empId}`);
            const fullEmployee = extractEmployeePayload(fullResponse);

            if (!isMounted || !fullEmployee) {
              return;
            }

            const mergedEmployee = {
              ...sessionEmployee,
              ...fullEmployee,
            };

            setEmployee(mergedEmployee);
            setPhoto(profilePhotoValue(mergedEmployee) || profilePhotoValue(sessionUser));
            setCover(profileCoverValue(mergedEmployee) || profileCoverValue(sessionUser));
            setEditForm(buildEditForm(sessionUser, mergedEmployee));
            return;
          } catch {
            // Keep session data if the detail API is unavailable.
          }
        }

        setPhoto(profilePhotoValue(sessionEmployee) || profilePhotoValue(sessionUser));
        setCover(profileCoverValue(sessionEmployee) || profileCoverValue(sessionUser));
        setEditForm(buildEditForm(sessionUser, sessionEmployee));
      } finally {
        if (isMounted) {
          setHydrating(false);
        }
      }
    }

    loadLatestProfile();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadCompanyIdentity() {
      const localCompanyName = companyNameFromPayload({}, user, employee);

      if (localCompanyName) {
        setCompanyName(localCompanyName);
      }

      try {
        const brandingResponse = await api('/tenant-branding');

        if (!isMounted) {
          return;
        }

        const resolvedCompanyName = companyNameFromPayload(
          brandingResponse,
          user,
          employee,
        );

        if (resolvedCompanyName) {
          setCompanyName(resolvedCompanyName);
        }
      } catch {
        // Keep the company name already available in the session/profile data.
      }
    }

    loadCompanyIdentity();

    return () => {
      isMounted = false;
    };
  }, [user, employee]);

  const primaryDetails = useMemo(() => {
    return [
      ['Name', firstValue(employee.employee_name, employee.name, user.name)],
      ['Display name', displayName],
      ['DOB', firstValue(employee.date_of_birth, employee.dob, employee.birth_date)],
      ['Gender', firstValue(employee.gender, employee.sex, employee.employee_gender)],
      ['Marital Status', firstValue(employee.marital_status)],
      ['Blood Group', firstValue(employee.blood_group)],
    ];
  }, [displayName, employee, user]);

  const contactDetails = useMemo(() => {
    return [
      ['Email', firstValue(employee.email, employee.official_email, user.email)],
      ['Work email', firstValue(employee.work_email, employee.official_email, employee.email, user.email)],
      ['Phone number', firstValue(employee.phone, employee.mobile, employee.contact, employee.contact_number)],
      ['Work number', firstValue(employee.work_phone, employee.work_number, employee.office_phone)],
      ['Emergency contact person', firstValue(employee.emergency_contact_name, employee.emergency_contact_person)],
      ['Emergency contact number', firstValue(employee.emergency_contact_number, employee.emergency_phone)],
    ];
  }, [employee, user]);

  const addressEducationDetails = useMemo(() => {
    return [
      ['Current address', firstValue(employee.current_address, employee.address)],
      ['Permanent address', firstValue(employee.permanent_address)],
      ['College', firstValue(employee.college)],
      ['School', firstValue(employee.school)],
      ['Qualification', firstValue(employee.qualification, employee.education)],
    ];
  }, [employee]);

  const organizationDetails = useMemo(() => {
    return [
      ['Company / Organisation', firstValue(
        companyName,
        employee.business_unit,
        employee.organisation,
        employee.organization,
        employee.organisation_name,
        employee.organization_name,
        user.tenant_id,
        employee.tenant_id,
      )],
      ['Department', firstValue(employee.department, employee.department_name)],
      ['Job title', titleCase(firstValue(employee.designation, employee.designation_name, employee.job_title, employee.title, employee.position))],
      ['Work type', firstValue(employee.work_type, employee.employee_type, employee.job_type, employee.employment_type)],
      ['Emp number', firstValue(employee.employee_id, employee.emp_code, employee.employee_code, employee.code)],
      ['Date of joining', firstValue(employee.joining_date, employee.date_of_joining, employee.doj)],
      ['Location', firstValue(employee.location, employee.office_location, employee.branch, employee.state)],
      ['Reporting manager', firstValue(employee.reporting_manager_name, employee.reporting_officer_name, employee.manager_name, employee.team_leader_name)],
      ['Shift', firstValue(employee.shift)],
      ['Weekly off policy', firstValue(employee.weekly_off_policy, employee.weekly_off)],
    ];
  }, [companyName, employee, user]);

  const roleAccessDetails = [
    ['Company', companyName],
    ['Primary Dashboard Role', dashboardRole],
    ['Dashboard Identity', dashboardIdentity],
    ['Additional Capabilities', capabilitySummary],
    ['Login Access', loginAccess],
    ['Department', firstValue(employee.department, employee.department_name)],
    ['Designation', titleCase(firstValue(
      employee.designation,
      employee.designation_name,
      employee.job_title,
      employee.title,
      employee.position,
    ))],
  ];

  const employmentDetails = [
    ['Employment Status', firstValue(employee.employment_status, employee.status)],
    ['Project', firstValue(employee.project, employee.project_name)],
    ['State', firstValue(employee.state)],
    ['Work Type', firstValue(
      employee.work_type,
      employee.employee_type,
      employee.job_type,
      employee.employment_type,
    )],
    ['Date of Joining', firstValue(
      employee.joining_date,
      employee.date_of_joining,
      employee.doj,
    )],
  ];

  const salaryAndStatutoryRows = [
    ['Gross Salary', firstValue(employee.gross_salary, employee.salary)],
    ['Payment Mode', firstValue(employee.payment_mode)],
    ['PAN No', firstValue(employee.pan_no, employee.pan)],
    ['Aadhar No', firstValue(employee.aadhar_no, employee.aadhaar_no, employee.aadhar)],
    ['Employee UAN No', firstValue(employee.employee_uan_no, employee.uan_no)],
    ['Employee ESIC IP', firstValue(employee.employee_esic_ip, employee.esic_ip)],
  ];

  const familyAndDisabilityRows = [
    ['Parents Senior Citizen?', boolLabel(employee.are_parents_senior_citizen)],
    ['Number of Children', firstValue(employee.number_of_children)],
    ['Children in Hostel', firstValue(employee.children_in_hostel)],
    ['Disability Level', firstValue(employee.disability_level)],
    ['Dependent Disability Level', firstValue(employee.dependent_disability_level)],
  ];

  const previousEmploymentRows = [
    ['Previous Employer Name', firstValue(employee.previous_employer_name)],
    ['Previous Designation', firstValue(employee.previous_designation)],
    ['Previous Employment From Date', firstValue(employee.previous_employment_tenure_from_date)],
    ['Previous Employment End Date', firstValue(employee.previous_employment_tenure_end_date)],
  ];

  const reportingRows = [
    ['Team Leader Capability', boolLabel(employee.is_team_leader)],
    ['Reporting Officer Capability', boolLabel(employee.is_reporting_officer)],
    ['Team Leader Name', firstValue(employee.team_leader_name)],
    ['Reporting Officer Name', firstValue(employee.reporting_officer_name)],
  ];

  function syncProfileState(nextUser = user, nextEmployee = employee) {
    const safeUser = nextUser || {};
    const safeEmployee = nextEmployee || {};

    setUser(safeUser);
    setEmployee(safeEmployee);
    setPhoto(profilePhotoValue(safeEmployee) || profilePhotoValue(safeUser));
    setCover(profileCoverValue(safeEmployee) || profileCoverValue(safeUser));
    setEditForm(buildEditForm(safeUser, safeEmployee));
  }

  async function refreshProfileSession() {
    try {
      const sessionData = await refreshCurrentSession();
      const sessionUser = sessionData?.user ? mergeProfileState(user, sessionData.user) : user;
      const sessionEmployee = sessionData?.employee
        ? mergeProfileState(employee, sessionData.employee)
        : employee;

      const empId = employeeId(sessionEmployee);

      if (empId) {
        try {
          const fullResponse = await api(`/employees/${empId}`);
          const fullEmployee = extractEmployeePayload(fullResponse);

          if (fullEmployee) {
            const mergedEmployee = {
              ...sessionEmployee,
              ...fullEmployee,
            };

            syncProfileState(sessionUser, mergedEmployee);
            return {
              user: sessionUser,
              employee: mergedEmployee,
            };
          }
        } catch {
          // Fallback to session data.
        }
      }

      syncProfileState(sessionUser, sessionEmployee);

      return {
        user: sessionUser,
        employee: sessionEmployee,
      };
    } catch {
      return null;
    }
  }

  function setEditField(field, value) {
    setEditForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function handlePhotoFileChange(event) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!validateImageFile(file, 2, alerts, 'Profile photo')) {
      event.target.value = '';
      return;
    }

    const empId = employeeId(employee);

    if (!empId) {
      alerts.error(
        'Employee profile ID was not found. Please ask HR/Admin to sync your employee profile.',
        'Profile Not Linked',
      );
      event.target.value = '';
      return;
    }

    try {
      setPhotoSaving(true);

      const data = await uploadEmployeeProfilePhoto(empId, file);
      const uploadedPhoto = data.photo || data.photo_url || '';

      if (uploadedPhoto) {
        setPhoto(uploadedPhoto);
      }

      const updatedEmployee = extractEmployeePayload(data);

      if (updatedEmployee) {
        syncProfileState(user, {
          ...employee,
          ...updatedEmployee,
        });
      }

      await refreshProfileSession();

      window.dispatchEvent(new Event('sds_hrms_profile_photo_updated'));

      alerts.success('Profile photo updated successfully.', 'Photo Saved');
    } catch (error) {
      alerts.error(error.message || 'Unable to update profile photo.', 'Photo Update Failed');
    } finally {
      setPhotoSaving(false);
      event.target.value = '';
    }
  }

  async function handleCoverFileChange(event) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!validateImageFile(file, 5, alerts, 'Cover image')) {
      event.target.value = '';
      return;
    }

    const empId = employeeId(employee);

    if (!empId) {
      alerts.error(
        'Employee profile ID was not found. Please ask HR/Admin to sync your employee profile.',
        'Profile Not Linked',
      );
      event.target.value = '';
      return;
    }

    try {
      setCoverSaving(true);

      const data = await uploadEmployeeProfileCover(empId, file);
      const uploadedCover = data.cover || data.cover_url || data.cover_image || '';

      if (uploadedCover) {
        setCover(uploadedCover);
      }

      const updatedEmployee = extractEmployeePayload(data);

      if (updatedEmployee) {
        syncProfileState(user, {
          ...employee,
          ...updatedEmployee,
        });
      }

      await refreshProfileSession();

      window.dispatchEvent(new Event('sds_hrms_profile_cover_updated'));

      alerts.success('Cover image updated successfully.', 'Cover Saved');
    } catch (error) {
      alerts.error(error.message || 'Unable to update cover image.', 'Cover Update Failed');
    } finally {
      setCoverSaving(false);
      event.target.value = '';
    }
  }

  async function removeProfilePhoto() {
    const empId = employeeId(employee);

    if (!empId) {
      alerts.error('Employee profile ID was not found.', 'Profile Not Linked');
      return;
    }

    try {
      setPhotoSaving(true);

      await api(`/employees/${empId}`, {
        method: 'PATCH',
        body: JSON.stringify(buildProfilePhotoPayload('')),
      });

      setPhoto('');

      const clearedEmployee = {
        ...employee,
        avatar: '',
        profile_photo: '',
        profile_picture: '',
        photo: '',
        image: '',
        picture: '',
        profile_photo_url: '',
        avatar_url: '',
        photo_url: '',
      };

      setEmployee(clearedEmployee);
      await refreshProfileSession();

      window.dispatchEvent(new Event('sds_hrms_profile_photo_updated'));

      alerts.success('Profile photo removed successfully.', 'Photo Removed');
    } catch (error) {
      alerts.error(error.message || 'Unable to remove profile photo.', 'Photo Remove Failed');
    } finally {
      setPhotoSaving(false);
    }
  }

  async function removeProfileCover() {
    const empId = employeeId(employee);

    if (!empId) {
      alerts.error('Employee profile ID was not found.', 'Profile Not Linked');
      return;
    }

    try {
      setCoverSaving(true);

      await api(`/employees/${empId}`, {
        method: 'PATCH',
        body: JSON.stringify(buildProfileCoverPayload('')),
      });

      setCover('');

      const clearedEmployee = {
        ...employee,
        cover_image: '',
        cover_photo: '',
        profile_cover: '',
        profile_cover_image: '',
        banner_image: '',
        banner_photo: '',
        employee_cover_image: '',
        employee_cover_photo: '',
        cover_url: '',
        profile_cover_url: '',
        banner_url: '',
      };

      setEmployee(clearedEmployee);
      await refreshProfileSession();

      window.dispatchEvent(new Event('sds_hrms_profile_cover_updated'));

      alerts.success('Cover image removed successfully.', 'Cover Removed');
    } catch (error) {
      alerts.error(error.message || 'Unable to remove cover image.', 'Cover Remove Failed');
    } finally {
      setCoverSaving(false);
    }
  }

  async function saveProfileDetails(event) {
    event.preventDefault();

    const empId = employeeId(employee);

    if (!empId) {
      alerts.error(
        'Employee profile ID was not found. Please ask HR/Admin to sync your employee profile.',
        'Profile Not Linked',
      );
      return;
    }

    if (!String(editForm.name || '').trim()) {
      alerts.warning('Full name is required.', 'Missing Name');
      return;
    }

    try {
      setProfileSaving(true);

      const payload = buildEmployeeProfileUpdatePayload(editForm);

      const data = await api(`/employees/${empId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });

      const updatedEmployee = extractEmployeePayload(data);

      if (updatedEmployee) {
        syncProfileState(user, {
          ...employee,
          ...updatedEmployee,
        });
      }

      await refreshProfileSession();

      setEditing(false);
      alerts.success('Profile updated successfully.', 'Profile Saved');
    } catch (error) {
      alerts.error(error.message || 'Unable to update profile.', 'Profile Update Failed');
    } finally {
      setProfileSaving(false);
    }
  }

  function cancelEditProfile() {
    setEditForm(buildEditForm(user, employee));
    setEditing(false);
  }

  async function submit(e) {
    e.preventDefault();

    if (!form.current_password.trim()) {
      alerts.warning('Current password is required.', 'Missing Current Password');
      return;
    }

    if (!form.new_password || form.new_password.length < 6) {
      alerts.warning('New password must be at least 6 characters.', 'Invalid New Password');
      return;
    }

    if (form.new_password !== form.confirm_password) {
      alerts.warning('New password and confirm password do not match.', 'Password Mismatch');
      return;
    }

    try {
      setSubmitting(true);

      const data = await api('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          current_password: form.current_password,
          new_password: form.new_password,
          confirm_password: form.confirm_password,
        }),
      });

      alerts.success(data.message || 'Password changed successfully.', 'Password Changed');

      setForm({
        current_password: '',
        new_password: '',
        confirm_password: '',
      });
    } catch (error) {
      alerts.error(
        error.message || 'Unable to change password.',
        'Password Change Failed',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page-grid profile-page profile-design-page">
      <style>{`
        .profile-design-page {
          --pr-ink: #101a3a;
          --pr-copy: #5d6d8d;
          --pr-violet: #6658dc;
          --pr-blue: #3766db;
          --pr-cyan: #18b5c8;
          --pr-teal: #34c9c4;
          --pr-yellow: #d8ff43;
          --pr-danger: #d84d68;
          display: grid;
          gap: clamp(18px, 2vw, 26px);
          width: 100%;
          max-width: 100%;
          padding: 0 0 18px;
          overflow-x: hidden;
          color: var(--pr-ink);
        }

        .profile-design-page * {
          box-sizing: border-box;
        }

        .profile-design-shell,
        .profile-info-card,
        .profile-edit-card,
        .profile-password-card {
          border: 1px solid rgba(171,181,211,.70);
          background: linear-gradient(145deg, #ffffff, #f7fbff);
          box-shadow:
            8px 10px 0 #c4ccff,
            0 24px 42px rgba(34,38,110,.10);
        }

        .profile-design-shell {
          overflow: hidden;
          border-radius: clamp(28px, 2.7vw, 40px);
        }

        .profile-cover {
          position: relative;
          isolation: isolate;
          height: clamp(180px, 26vw, 260px);
          overflow: hidden;
          background:
            radial-gradient(circle at 12% 20%, rgba(105,217,208,.28), transparent 28%),
            radial-gradient(circle at 88% 10%, rgba(153,164,245,.28), transparent 30%),
            linear-gradient(135deg, #26326d 0%, #6658dc 48%, #18b5c8 100%);
        }

        .profile-cover::before {
          content: "";
          position: absolute;
          inset: 0;
          z-index: 1;
          background:
            linear-gradient(rgba(255,255,255,.06) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,.06) 1px, transparent 1px);
          background-size: 30px 30px;
          mask-image: linear-gradient(to bottom, black, transparent);
          pointer-events: none;
        }

        .profile-cover::after {
          content: "";
          position: absolute;
          inset: 0;
          z-index: 1;
          background: linear-gradient(180deg, rgba(16,26,58,.04), rgba(16,26,58,.34));
          pointer-events: none;
        }

        .profile-cover img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .profile-cover-placeholder {
          height: 100%;
          display: grid;
          place-items: center;
          color: rgba(255,255,255,.42);
          font-family: Georgia, "Times New Roman", serif;
          font-size: clamp(54px, 10vw, 104px);
          font-weight: 800;
          letter-spacing: -.07em;
        }

        .profile-cover-actions {
          position: absolute;
          z-index: 4;
          right: 22px;
          bottom: 20px;
          display: flex;
          gap: 9px;
          flex-wrap: wrap;
        }

        .profile-media-btn,
        .profile-send-btn,
        .profile-edit-mini,
        .profile-design-page .primary,
        .profile-design-page .secondary {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          border-radius: 15px;
          font-weight: 900;
          cursor: pointer;
          transition:
            transform 190ms ease,
            box-shadow 190ms ease,
            filter 190ms ease,
            opacity 190ms ease;
        }

        .profile-media-btn:hover,
        .profile-send-btn:hover,
        .profile-edit-mini:hover,
        .profile-design-page .primary:hover:not(:disabled),
        .profile-design-page .secondary:hover:not(:disabled) {
          transform: translateY(-2px);
          filter: saturate(1.04);
        }

        .profile-media-btn {
          min-height: 42px;
          padding: 9px 13px;
          border: 1px solid rgba(255,255,255,.68);
          color: #40348d;
          background: rgba(255,255,255,.92);
          box-shadow:
            4px 5px 0 rgba(185,215,255,.82),
            0 14px 28px rgba(16,26,58,.18);
          backdrop-filter: blur(10px);
          font-size: 12px;
          white-space: nowrap;
        }

        .profile-media-btn input {
          display: none;
        }

        .profile-media-btn.danger {
          color: #a2344d;
          background: rgba(255,240,242,.95);
          border-color: rgba(216,77,104,.22);
          box-shadow: 4px 5px 0 #f2c2cc;
        }

        .profile-header {
          position: relative;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          gap: 20px;
          padding: 0 clamp(20px, 3vw, 34px) 24px;
          border-bottom: 1px solid rgba(171,181,211,.42);
          background:
            radial-gradient(circle at 0% 0%, rgba(105,217,208,.10), transparent 25%),
            radial-gradient(circle at 100% 0%, rgba(102,88,220,.08), transparent 27%),
            #fff;
        }

        .profile-avatar-wrap {
          position: relative;
          width: 118px;
          height: 118px;
          margin-top: -58px;
          border-radius: 34px;
          border: 5px solid #fff;
          background: linear-gradient(145deg, #edf6ff, #f1efff);
          color: #40348d;
          display: grid;
          place-items: center;
          overflow: visible;
          box-shadow:
            7px 8px 0 #b9d7ff,
            0 18px 36px rgba(16,26,58,.18);
          font-size: 31px;
          font-weight: 900;
          z-index: 4;
        }

        .profile-avatar-wrap img,
        .profile-avatar-wrap > span {
          width: 100%;
          height: 100%;
          border-radius: 29px;
          display: flex;
          align-items: center;
          justify-content: center;
          object-fit: cover;
          overflow: hidden;
        }

        .profile-avatar-upload {
          position: absolute;
          right: -8px;
          bottom: 7px;
          z-index: 10;
          width: 36px;
          height: 36px;
          border-radius: 13px;
          border: 3px solid #fff;
          color: #fff;
          background: linear-gradient(145deg, #6658dc, #18b5c8);
          box-shadow: 3px 4px 0 #b9d7ff;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }

        .profile-avatar-upload input {
          display: none;
        }

        .profile-main-info {
          padding-top: 18px;
          min-width: 0;
        }

        .profile-eyebrow,
        .profile-section-kicker {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          width: max-content;
          max-width: 100%;
          border-radius: 999px;
          color: #fff;
          background: #342b78;
          font-size: 9px;
          font-weight: 950;
          line-height: 1;
          letter-spacing: .11em;
          text-transform: uppercase;
        }

        .profile-eyebrow {
          margin-bottom: 12px;
          padding: 8px 12px;
          box-shadow: 4px 5px 0 #18b5c8;
        }

        .profile-section-kicker {
          margin-bottom: 10px;
          padding: 7px 10px;
          box-shadow: 3px 4px 0 #18b5c8;
        }

        .profile-main-info h1 {
          margin: 0;
          color: var(--pr-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(36px, 5vw, 62px);
          font-weight: 760;
          line-height: .96;
          letter-spacing: -.052em;
          overflow-wrap: anywhere;
        }

        .profile-main-info p {
          margin: 9px 0 14px;
          color: var(--pr-violet);
          font-size: clamp(13px, 1.1vw, 16px);
          font-weight: 900;
          line-height: 1.4;
        }

        .profile-inline-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 9px;
          color: var(--pr-copy);
          font-size: 12px;
          font-weight: 750;
        }

        .profile-inline-meta span {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          max-width: 100%;
          padding: 8px 10px;
          border: 1px solid rgba(171,181,211,.48);
          border-radius: 999px;
          background: rgba(255,255,255,.86);
          box-shadow: 2px 3px 0 rgba(52,43,120,.07);
          overflow-wrap: anywhere;
        }

        .profile-inline-meta svg {
          color: var(--pr-violet);
          flex: 0 0 auto;
        }

        .profile-send-btn {
          align-self: center;
          min-height: 48px;
          padding: 10px 16px;
          border: 0;
          color: #fff;
          background: linear-gradient(135deg, #342b78, #4f65d7 58%, #18b5c8);
          box-shadow:
            5px 6px 0 #a9d6f5,
            0 14px 25px rgba(36,74,128,.16);
          white-space: nowrap;
        }

        .profile-mini-row {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          border-top: 1px solid rgba(171,181,211,.34);
          background: #fff;
        }

        .profile-mini-item {
          padding: 16px clamp(20px, 3vw, 34px);
          min-width: 0;
          border-right: 1px solid rgba(171,181,211,.34);
        }

        .profile-mini-item:last-child {
          border-right: 0;
        }

        .profile-mini-item span {
          display: block;
          margin-bottom: 5px;
          color: #5d6785;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: .08em;
          text-transform: uppercase;
        }

        .profile-mini-item strong {
          display: block;
          color: var(--pr-ink);
          font-size: 13px;
          font-weight: 850;
          overflow-wrap: anywhere;
        }

        .profile-card-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 20px;
        }

        .profile-info-card,
        .profile-edit-card,
        .profile-password-card {
          min-width: 0;
          border-radius: clamp(24px, 2.2vw, 32px);
          overflow: hidden;
          transition:
            transform 210ms ease,
            box-shadow 210ms ease,
            border-color 210ms ease;
        }

        .profile-info-card:hover,
        .profile-edit-card:hover,
        .profile-password-card:hover {
          border-color: rgba(102,88,220,.28);
          transform: translateY(-3px);
          box-shadow:
            10px 12px 0 #c4ccff,
            0 30px 50px rgba(34,38,110,.14);
        }

        .profile-section-head {
          min-height: 58px;
          padding: 16px 18px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          border-bottom: 1px solid rgba(171,181,211,.38);
          background: linear-gradient(180deg, #fbfbff, #f6f9fc);
        }

        .profile-section-title {
          display: flex;
          align-items: center;
          gap: 9px;
          min-width: 0;
        }

        .profile-section-title svg {
          color: var(--pr-violet);
          flex: 0 0 auto;
        }

        .profile-section-head h3 {
          margin: 0;
          color: var(--pr-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: 19px;
          font-weight: 760;
          letter-spacing: -.03em;
        }

        .profile-edit-mini {
          min-height: 35px;
          padding: 7px 11px;
          border: 1px solid rgba(102,88,220,.20);
          color: #40348d;
          background: #f1efff;
          box-shadow: 3px 4px 0 #c9c0ff;
          font-size: 11px;
          white-space: nowrap;
        }

        .profile-field-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          padding: 18px;
        }

        .profile-field {
          min-width: 0;
          padding: 13px;
          border: 1px solid rgba(171,181,211,.44);
          border-radius: 16px;
          background: #edf6ff;
          box-shadow: 3px 4px 0 #b9d7ff;
        }

        .profile-field:nth-child(4n + 2) {
          background: #eaf8f4;
          box-shadow: 3px 4px 0 #aee6d9;
        }

        .profile-field:nth-child(4n + 3) {
          background: #fff4d5;
          box-shadow: 3px 4px 0 #ffe0a5;
        }

        .profile-field:nth-child(4n + 4) {
          background: #f1efff;
          box-shadow: 3px 4px 0 #c9c0ff;
        }

        .profile-field span {
          display: block;
          margin-bottom: 6px;
          color: #5d6785;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: .07em;
          text-transform: uppercase;
        }

        .profile-field strong {
          display: block;
          color: var(--pr-ink);
          font-size: 13px;
          line-height: 1.5;
          font-weight: 800;
          overflow-wrap: anywhere;
        }

        .profile-edit-card,
        .profile-password-card {
          padding: clamp(20px, 2vw, 28px);
        }

        .profile-edit-title {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 14px;
          margin-bottom: 18px;
          padding-bottom: 16px;
          border-bottom: 1px solid rgba(171,181,211,.40);
        }

        .profile-edit-title h3,
        .profile-password-card h3 {
          margin: 0;
          color: var(--pr-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(24px, 2.3vw, 34px);
          font-weight: 760;
          letter-spacing: -.04em;
        }

        .profile-edit-title p,
        .profile-password-card p {
          margin: 7px 0 0;
          color: var(--pr-copy);
          font-size: 13px;
          line-height: 1.58;
        }

        .profile-edit-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 13px;
        }

        .profile-edit-grid label,
        .profile-password-card label {
          display: grid;
          gap: 8px;
          min-width: 0;
          color: #303b5b;
          font-size: 11px;
          font-weight: 900;
        }

        .profile-edit-grid input,
        .profile-edit-grid textarea,
        .profile-password-card input {
          width: 100%;
          min-width: 0;
          border: 1px solid rgba(151,161,197,.58);
          border-radius: 15px;
          background: rgba(255,255,255,.94);
          color: var(--pr-ink);
          padding: 11px 13px;
          outline: none;
          font: inherit;
          transition:
            border-color 170ms ease,
            box-shadow 170ms ease,
            transform 170ms ease;
        }

        .profile-edit-grid textarea {
          min-height: 92px;
          resize: vertical;
        }

        .profile-edit-grid input:focus,
        .profile-edit-grid textarea:focus,
        .profile-password-card input:focus {
          border-color: rgba(102,88,220,.65);
          box-shadow:
            4px 5px 0 rgba(102,88,220,.14),
            0 0 0 4px rgba(102,88,220,.08);
          transform: translateY(-1px);
        }

        .profile-edit-grid .span-3 {
          grid-column: 1 / -1;
        }

        .profile-form-actions {
          display: flex;
          justify-content: flex-end;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 18px;
        }

        .profile-design-page .primary,
        .profile-design-page .secondary {
          min-height: 45px;
          padding: 9px 15px;
          border: 0;
        }

        .profile-design-page .primary {
          color: #fff;
          background: linear-gradient(135deg, #342b78, #4f65d7 58%, #18b5c8);
          box-shadow:
            5px 6px 0 #a9d6f5,
            0 14px 25px rgba(36,74,128,.16);
        }

        .profile-design-page .secondary {
          color: #40348d;
          background: rgba(255,255,255,.92);
          border: 1px solid rgba(65,55,161,.18);
          box-shadow: 3px 4px 0 rgba(52,43,120,.10);
        }

        .profile-password-card {
          background:
            radial-gradient(circle at 0% 0%, rgba(105,217,208,.12), transparent 28%),
            radial-gradient(circle at 100% 0%, rgba(102,88,220,.10), transparent 30%),
            linear-gradient(145deg, #ffffff, #f7fbff);
        }

        .profile-password-card .dynamic-form {
          margin-top: 18px;
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
          gap: 13px;
          align-items: end;
        }

        .profile-loading-note {
          margin-top: 12px;
          padding: 9px 11px;
          width: max-content;
          max-width: 100%;
          border-radius: 999px;
          color: #245da8;
          background: #edf6ff;
          box-shadow: 2px 3px 0 #b9d7ff;
          font-size: 11px;
          font-weight: 850;
        }

        .profile-reporting-avatar {
          display: none !important;
        }

        @media (max-width: 1100px) {
          .profile-header {
            grid-template-columns: auto minmax(0, 1fr);
          }

          .profile-send-btn {
            grid-column: 1 / -1;
            width: fit-content;
          }

          .profile-card-grid {
            grid-template-columns: 1fr;
          }

          .profile-edit-grid,
          .profile-password-card .dynamic-form {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .profile-password-card .dynamic-form button {
            grid-column: 1 / -1;
          }
        }

        @media (max-width: 720px) {
          .profile-design-page {
            gap: 16px;
          }

          .profile-cover {
            height: 170px;
          }

          .profile-cover-actions {
            left: 14px;
            right: 14px;
            bottom: 14px;
          }

          .profile-header {
            grid-template-columns: 1fr;
            gap: 12px;
            padding: 0 16px 18px;
          }

          .profile-avatar-wrap {
            width: 104px;
            height: 104px;
            margin-top: -50px;
          }

          .profile-main-info {
            padding-top: 0;
          }

          .profile-main-info h1 {
            font-size: clamp(34px, 10vw, 48px);
          }

          .profile-inline-meta {
            display: grid;
            grid-template-columns: 1fr;
          }

          .profile-send-btn,
          .profile-media-btn,
          .profile-edit-mini,
          .profile-form-actions button,
          .profile-password-card button {
            width: 100%;
          }

          .profile-mini-row,
          .profile-field-grid,
          .profile-edit-grid,
          .profile-password-card .dynamic-form {
            grid-template-columns: 1fr;
          }

          .profile-mini-item {
            border-right: 0;
            border-bottom: 1px solid rgba(171,181,211,.34);
          }

          .profile-mini-item:last-child {
            border-bottom: 0;
          }

          .profile-section-head,
          .profile-edit-title {
            align-items: stretch;
            flex-direction: column;
          }

          .profile-edit-grid .span-3,
          .profile-password-card .dynamic-form button {
            grid-column: auto;
          }
        }

        @media (max-width: 430px) {
          .profile-cover {
            height: 150px;
          }

          .profile-cover-actions {
            display: grid;
            grid-template-columns: 1fr;
          }

          .profile-avatar-wrap {
            width: 92px;
            height: 92px;
            border-radius: 28px;
          }

          .profile-avatar-wrap img,
          .profile-avatar-wrap > span {
            border-radius: 23px;
          }

          .profile-main-info h1 {
            font-size: clamp(31px, 11vw, 42px);
          }

          .profile-info-card,
          .profile-edit-card,
          .profile-password-card {
            border-radius: 22px;
          }

          .profile-edit-card,
          .profile-password-card {
            padding: 15px;
          }

          .profile-field-grid {
            padding: 14px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .profile-design-page *,
          .profile-design-page *::before,
          .profile-design-page *::after {
            animation: none !important;
            transition: none !important;
          }
        }
      `}</style>

      <section className="profile-design-shell">
        <div className="profile-cover">
          {previewCoverUrl ? (
            <img src={previewCoverUrl} alt={`${mainName} cover`} />
          ) : (
            <div className="profile-cover-placeholder">SDS</div>
          )}

          <div className="profile-cover-actions">
            <label className="profile-media-btn">
              <ImagePlus size={15} />
              {coverSaving ? 'Uploading...' : 'Change Cover'}
              <input
                type="file"
                accept="image/*"
                disabled={coverSaving}
                onChange={handleCoverFileChange}
              />
            </label>

            {cover ? (
              <button
                type="button"
                className="profile-media-btn danger"
                disabled={coverSaving}
                onClick={removeProfileCover}
              >
                <Trash2 size={14} />
                Remove
              </button>
            ) : null}
          </div>
        </div>

        <div className="profile-header">
          <div className="profile-avatar-wrap">
            {previewPhotoUrl ? (
              <img src={previewPhotoUrl} alt={mainName} />
            ) : (
              <span>{getInitials(mainName)}</span>
            )}

            <label className="profile-avatar-upload" title="Change profile photo">
              <Camera size={15} />
              <input
                type="file"
                accept="image/*"
                disabled={photoSaving}
                onChange={handlePhotoFileChange}
              />
            </label>
          </div>

          <div className="profile-main-info">
            <span className="profile-eyebrow">
              <Sparkles size={13} />
              My Profile
            </span>
            <h1>{mainName}</h1>
            <p>{mainRole}</p>

            <div className="profile-inline-meta">
              <span><Mail size={14} />{firstValue(employee.email, employee.official_email, user.email, '—')}</span>
              <span><Phone size={14} />{firstValue(employee.phone, employee.mobile, '—')}</span>
              <span>{firstValue(employee.employee_id, employee.emp_code, employee.employee_code, '—')}</span>
              <span><MapPin size={14} />{firstValue(employee.location, employee.branch, employee.state, '—')}</span>
            </div>

            {hydrating ? (
              <div className="profile-loading-note">Refreshing latest profile data...</div>
            ) : null}
          </div>

          <button type="button" className="profile-send-btn" onClick={() => setEditing(true)}>
            <Pencil size={15} />
            Edit Profile
            <ArrowUpRight size={14} />
          </button>
        </div>

        <div className="profile-mini-row">
          <div className="profile-mini-item">
            <span>Department</span>
            <strong>{firstValue(employee.department, employee.department_name, '—')}</strong>
          </div>

          <div className="profile-mini-item">
            <span>Reporting manager</span>
            <strong>
              {firstValue(
                employee.reporting_manager_name,
                employee.reporting_officer_name,
                employee.manager_name,
                employee.team_leader_name,
              ) ? (
                <>
                  {firstValue(
                    employee.reporting_manager_name,
                    employee.reporting_officer_name,
                    employee.manager_name,
                    employee.team_leader_name,
                  )}
                </>
              ) : (
                '—'
              )}
            </strong>
          </div>
        </div>
      </section>

      {editing ? (
        <section className="profile-edit-card">
          <div className="profile-edit-title">
            <div>
              <h3>Edit Personal Details</h3>
              <p>
                Employees can update safe personal details only. Official HR fields remain unchanged.
              </p>
            </div>

            <button
              type="button"
              className="secondary"
              disabled={profileSaving}
              onClick={cancelEditProfile}
            >
              Close
            </button>
          </div>

          <form onSubmit={saveProfileDetails} noValidate>
            <div className="profile-edit-grid">
              <label>
                Full Name
                <input
                  value={editForm.name}
                  onChange={(event) => setEditField('name', event.target.value)}
                />
              </label>

              <label>
                Phone
                <input
                  value={editForm.phone}
                  onChange={(event) => setEditField('phone', event.target.value)}
                />
              </label>

              <label>
                Personal Email
                <input
                  type="email"
                  value={editForm.personal_email}
                  onChange={(event) => setEditField('personal_email', event.target.value)}
                />
              </label>

              <label>
                Gender
                <input
                  value={editForm.gender}
                  onChange={(event) => setEditField('gender', event.target.value)}
                />
              </label>

              <label>
                Date Of Birth
                <input
                  type="date"
                  value={editForm.date_of_birth}
                  onChange={(event) => setEditField('date_of_birth', event.target.value)}
                />
              </label>

              <label>
                Blood Group
                <input
                  value={editForm.blood_group}
                  onChange={(event) => setEditField('blood_group', event.target.value)}
                />
              </label>

              <label>
                Marital Status
                <input
                  value={editForm.marital_status}
                  onChange={(event) => setEditField('marital_status', event.target.value)}
                />
              </label>

              <label>
                College
                <input
                  value={editForm.college}
                  onChange={(event) => setEditField('college', event.target.value)}
                />
              </label>

              <label>
                School
                <input
                  value={editForm.school}
                  onChange={(event) => setEditField('school', event.target.value)}
                />
              </label>

              <label>
                Qualification
                <input
                  value={editForm.qualification}
                  onChange={(event) => setEditField('qualification', event.target.value)}
                />
              </label>

              <label>
                Emergency Contact Person
                <input
                  value={editForm.emergency_contact_name}
                  onChange={(event) => setEditField('emergency_contact_name', event.target.value)}
                />
              </label>

              <label>
                Emergency Contact Number
                <input
                  value={editForm.emergency_contact_number}
                  onChange={(event) => setEditField('emergency_contact_number', event.target.value)}
                />
              </label>

              <label className="span-3">
                Current Address
                <textarea
                  value={editForm.current_address}
                  onChange={(event) => setEditField('current_address', event.target.value)}
                />
              </label>

              <label className="span-3">
                Permanent Address
                <textarea
                  value={editForm.permanent_address}
                  onChange={(event) => setEditField('permanent_address', event.target.value)}
                />
              </label>
            </div>

            <div className="profile-form-actions">
              <button
                type="button"
                className="secondary"
                disabled={profileSaving}
                onClick={cancelEditProfile}
              >
                Cancel
              </button>

              <button
                type="submit"
                className="primary"
                disabled={profileSaving}
              >
                <CheckCircle2 size={16} />
                {profileSaving ? 'Saving...' : 'Save Profile'}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <div className="profile-card-grid">
        <ProfileSection
          title="Role, Access & Company"
          rows={roleAccessDetails}
        />

        <ProfileSection
          title="Primary Details"
          rows={primaryDetails}
          onEdit={() => setEditing(true)}
        />

        <ProfileSection
          title="Contact Details"
          rows={contactDetails}
          onEdit={() => setEditing(true)}
        />

        <ProfileSection
          title="Address & Education"
          rows={addressEducationDetails}
          onEdit={() => setEditing(true)}
        />

        <ProfileSection
          title="Organization"
          rows={organizationDetails}
          onEdit={() => setEditing(true)}
        />

        <ProfileSection
          title="Employment Details"
          rows={employmentDetails}
        />

        <ProfileSection
          title="Salary & Statutory Details"
          rows={salaryAndStatutoryRows}
        />

        <ProfileSection
          title="Family & Disability Details"
          rows={familyAndDisabilityRows}
        />

        <ProfileSection
          title="Previous Employment Details"
          rows={previousEmploymentRows}
        />

        <ProfileSection
          title="Reporting Hierarchy"
          rows={reportingRows}
        />
      </div>

      {photo ? (
        <button
          type="button"
          className="secondary"
          disabled={photoSaving}
          onClick={removeProfilePhoto}
          style={{ width: 'fit-content', maxWidth: '100%' }}
        >
          Remove Profile Photo
        </button>
      ) : null}

      <section className="profile-password-card">
        <span className="profile-section-kicker">
          <KeyRound size={13} />
          Account Security
        </span>
        <h3>Change Password</h3>
        <p>Update your own login password securely. Super Admin approval is not required.</p>

        <form className="dynamic-form" onSubmit={submit} noValidate>
          <label>
            Current Password
            <input
              type="password"
              value={form.current_password}
              autoComplete="current-password"
              required
              onChange={(e) =>
                setForm({ ...form, current_password: e.target.value })
              }
            />
          </label>

          <label>
            New Password
            <input
              type="password"
              value={form.new_password}
              autoComplete="new-password"
              minLength={6}
              required
              onChange={(e) =>
                setForm({ ...form, new_password: e.target.value })
              }
            />
          </label>

          <label>
            Confirm New Password
            <input
              type="password"
              value={form.confirm_password}
              autoComplete="new-password"
              minLength={6}
              required
              onChange={(e) =>
                setForm({ ...form, confirm_password: e.target.value })
              }
            />
          </label>

          <button type="submit" className="primary" disabled={submitting}>
            <ShieldCheck size={16} />
            {submitting ? 'Changing Password...' : 'Change Password'}
          </button>
        </form>
      </section>
    </div>
  );
}