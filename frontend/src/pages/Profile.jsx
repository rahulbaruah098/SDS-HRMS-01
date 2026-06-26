import { useEffect, useMemo, useState } from 'react';
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

  return [];
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

function capabilityLabel(employee = {}, roles = []) {
  const labels = [];

  if (
    boolLabel(employee.is_team_leader) === 'Yes' ||
    roles.includes('team_leader')
  ) {
    labels.push('Team Leader');
  }

  if (
    boolLabel(employee.is_reporting_officer) === 'Yes' ||
    roles.includes('reporting_officer') ||
    roles.includes('manager') ||
    roles.includes('ro')
  ) {
    labels.push('Reporting Officer');
  }

  return labels.length ? labels.join(' + ') : 'No additional capability';
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
        <h3>{title}</h3>

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
  const capabilities = capabilityLabel(employee, userRoles);

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
          ? mergeNonEmpty(user, sessionData.user)
          : user;

        const sessionEmployee = sessionData?.employee
          ? mergeNonEmpty(employee, sessionData.employee)
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
      ['Business unit', firstValue(
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
  }, [employee, user]);

  const employmentDetails = [
    ['Dashboard Role', 'Employee'],
    ['Login Access', userRoles.map(roleLabel).join(', ')],
    ['Employee Capability', capabilities],
    ['Employment Status', firstValue(employee.employment_status, employee.status)],
    ['Project', firstValue(employee.project, employee.project_name)],
    ['State', firstValue(employee.state)],
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
      const sessionUser = sessionData?.user ? mergeNonEmpty(user, sessionData.user) : user;
      const sessionEmployee = sessionData?.employee
        ? mergeNonEmpty(employee, sessionData.employee)
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

      const data = await api('/password-requests', {
        method: 'POST',
        body: JSON.stringify({
          current_password: form.current_password,
          new_password: form.new_password,
        }),
      });

      alerts.success(data.message || 'Password change request submitted.', 'Request Submitted');

      setForm({
        current_password: '',
        new_password: '',
        confirm_password: '',
      });
    } catch (error) {
      alerts.error(
        error.message || 'Unable to submit password change request.',
        'Password Request Failed',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page-grid profile-page profile-design-page">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Pacifico&display=swap');

        .profile-design-page {
          display: grid;
          gap: 18px;
          background: #f8fafc;
          padding: 0 0 12px;
          width: 100%;
          max-width: 100%;
          overflow-x: hidden;
          font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
        }

        .profile-design-shell {
          width: 100%;
          max-width: 100%;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          background: #ffffff;
          box-shadow: 0 8px 24px rgba(15, 23, 42, .05);
          overflow: hidden;
        }

        .profile-cover {
          position: relative;
          height: clamp(130px, 22vw, 164px);
          overflow: hidden;
          background:
            linear-gradient(135deg, rgba(15,23,42,.78), rgba(15,23,42,.58)),
            radial-gradient(circle at 20% 0%, rgba(79,70,229,.22), transparent 34%),
            radial-gradient(circle at 84% 4%, rgba(14,165,233,.16), transparent 36%),
            linear-gradient(135deg, #111827, #374151);
        }

        .profile-cover img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .profile-cover::after {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(180deg, rgba(15,23,42,.05), rgba(15,23,42,.18));
          pointer-events: none;
        }

        .profile-cover-placeholder {
          height: 100%;
          display: grid;
          place-items: center;
          color: rgba(255,255,255,.24);
          font-size: clamp(34px, 7vw, 56px);
          font-weight: 900;
          letter-spacing: -.08em;
        }

        .profile-cover-actions {
          position: absolute;
          z-index: 3;
          right: 18px;
          bottom: 18px;
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .profile-media-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          border: 1px solid rgba(226,232,240,.9);
          border-radius: 6px;
          padding: 8px 11px;
          background: rgba(255,255,255,.92);
          color: #0f172a;
          font-size: 12px;
          font-weight: 800;
          cursor: pointer;
          box-shadow: 0 10px 20px rgba(15,23,42,.14);
          backdrop-filter: blur(10px);
          white-space: nowrap;
        }

        .profile-media-btn input {
          display: none;
        }

        .profile-media-btn.danger {
          background: rgba(254,242,242,.94);
          border-color: #fecaca;
          color: #b91c1c;
        }

        .profile-header {
          position: relative;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          gap: 18px;
          padding: 0 22px 18px;
          border-bottom: 1px solid #eef2f7;
          max-width: 100%;
        }

        .profile-avatar-wrap {
          position: relative;
          width: 98px;
          height: 98px;
          margin-top: -48px;
          border-radius: 999px;
          border: 4px solid #ffffff;
          background: #eef2ff;
          color: #4f46e5;
          display: grid;
          place-items: center;
          overflow: visible;
          box-shadow: 0 8px 22px rgba(15,23,42,.15);
          font-size: 28px;
          font-weight: 900;
          z-index: 4;
        }

        .profile-avatar-wrap img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
          border-radius: 999px;
        }

        .profile-avatar-wrap > span {
          width: 100%;
          height: 100%;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }

        .profile-avatar-upload {
          position: absolute;
          right: -8px;
          bottom: 6px;
          z-index: 10;
          width: 30px;
          height: 30px;
          border-radius: 999px;
          border: 3px solid #ffffff;
          background: #10b981;
          color: #ffffff;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          font-size: 15px;
          line-height: 1;
          box-shadow: 0 6px 14px rgba(15,23,42,.22);
        }

        .profile-avatar-upload input {
          display: none;
        }

        .profile-main-info {
          padding-top: 16px;
          min-width: 0;
        }

        .profile-main-info h1 {
          margin: 0;
          color: #111827;
          font-family: 'Pacifico', 'Brush Script MT', cursive;
          font-size: clamp(24px, 4vw, 32px);
          line-height: 1.25;
          font-weight: 400;
          letter-spacing: .01em;
          overflow-wrap: anywhere;
        }

        .profile-main-info p {
          margin: 4px 0 12px;
          color: #4f46e5;
          font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
          font-size: 14px;
          font-weight: 800;
          letter-spacing: .01em;
        }

        .profile-inline-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 10px 16px;
          color: #6b7280;
          font-size: 12px;
          font-weight: 600;
          max-width: 100%;
        }

        .profile-inline-meta span {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
          overflow-wrap: anywhere;
          word-break: break-word;
        }

        .profile-inline-meta svg {
          color: #94a3b8;
          flex: 0 0 auto;
        }

        .profile-send-btn {
          align-self: center;
          border: 1px solid #facc15;
          border-radius: 8px;
          background: #fef3c7;
          color: #713f12;
          padding: 9px 14px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          font-size: 12px;
          font-weight: 900;
          white-space: nowrap;
          cursor: pointer;
        }

        .profile-mini-row {
          display: grid;
          grid-template-columns: 160px minmax(0, 1fr);
          border-bottom: 1px solid #eef2f7;
        }

        .profile-mini-item {
          padding: 12px 22px;
          border-right: 1px solid #eef2f7;
          min-width: 0;
        }

        .profile-mini-item:last-child {
          border-right: 0;
        }

        .profile-mini-item span {
          display: block;
          color: #94a3b8;
          font-size: 11px;
          font-weight: 700;
          margin-bottom: 3px;
        }

        .profile-mini-item strong {
          display: block;
          color: #111827;
          font-size: 12px;
          font-weight: 800;
          overflow-wrap: anywhere;
        }

        .profile-reporting-avatar {
          display: none !important;
        }

        .profile-card-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 18px;
          margin-top: 18px;
          width: 100%;
          max-width: 100%;
        }

        .profile-info-card {
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          background: #ffffff;
          box-shadow: 0 6px 18px rgba(15,23,42,.04);
          overflow: hidden;
          min-width: 0;
        }

        .profile-section-head {
          min-height: 48px;
          padding: 13px 17px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          border-bottom: 1px solid #eef2f7;
        }

        .profile-section-head h3 {
          margin: 0;
          color: #111827;
          font-size: 15px;
          font-weight: 900;
          letter-spacing: -.01em;
        }

        .profile-edit-mini {
          border: 1px solid #facc15;
          border-radius: 8px;
          background: #fffbeb;
          color: #713f12;
          padding: 6px 10px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          font-weight: 900;
          cursor: pointer;
          white-space: nowrap;
        }

        .profile-field-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          column-gap: 22px;
          row-gap: 16px;
          padding: 18px;
        }

        .profile-field {
          min-width: 0;
        }

        .profile-field span {
          display: block;
          color: #9ca3af;
          font-size: 11px;
          font-weight: 700;
          margin-bottom: 5px;
        }

        .profile-field strong {
          display: block;
          color: #111827;
          font-size: 12px;
          line-height: 1.45;
          font-weight: 700;
          overflow-wrap: anywhere;
          word-break: break-word;
        }

        .profile-edit-card {
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          background: #ffffff;
          box-shadow: 0 6px 18px rgba(15,23,42,.04);
          padding: 18px;
          min-width: 0;
        }

        .profile-edit-title {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 14px;
          margin-bottom: 16px;
          padding-bottom: 14px;
          border-bottom: 1px solid #eef2f7;
        }

        .profile-edit-title h3 {
          margin: 0;
          color: #111827;
          font-size: 16px;
        }

        .profile-edit-title p {
          margin: 5px 0 0;
          color: #6b7280;
          font-size: 12px;
          line-height: 1.5;
        }

        .profile-edit-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 13px;
        }

        .profile-edit-grid label {
          display: grid;
          gap: 6px;
          color: #4b5563;
          font-size: 12px;
          font-weight: 800;
          min-width: 0;
        }

        .profile-edit-grid input,
        .profile-edit-grid textarea {
          width: 100%;
          border: 1px solid #d1d5db;
          border-radius: 8px;
          background: #ffffff;
          color: #111827;
          padding: 10px 11px;
          outline: none;
          transition: .18s ease;
          font: inherit;
          min-width: 0;
        }

        .profile-edit-grid textarea {
          min-height: 86px;
          resize: vertical;
        }

        .profile-edit-grid input:focus,
        .profile-edit-grid textarea:focus {
          border-color: #4f46e5;
          box-shadow: 0 0 0 3px rgba(79,70,229,.12);
        }

        .profile-edit-grid .span-3 {
          grid-column: 1 / -1;
        }

        .profile-form-actions {
          display: flex;
          justify-content: flex-end;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 16px;
        }

        .profile-password-card {
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          background: #ffffff;
          box-shadow: 0 6px 18px rgba(15,23,42,.04);
          padding: 18px;
          margin-top: 18px;
          min-width: 0;
        }

        .profile-password-card h3 {
          margin: 0 0 6px;
          color: #111827;
          font-size: 16px;
        }

        .profile-password-card p {
          margin: 0 0 14px;
          color: #6b7280;
          font-size: 12px;
        }

        .profile-password-card input {
          border-radius: 8px;
        }

        .profile-loading-note {
          font-size: 12px;
          color: #64748b;
          padding: 8px 0 0;
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

          .profile-edit-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 720px) {
          .profile-design-page {
            gap: 14px;
          }

          .profile-cover {
            height: 132px;
          }

          .profile-cover-actions {
            left: 12px;
            right: 12px;
            bottom: 12px;
          }

          .profile-header {
            grid-template-columns: 1fr;
            gap: 10px;
            padding: 0 16px 16px;
          }

          .profile-avatar-wrap {
            width: 88px;
            height: 88px;
            margin-top: -42px;
          }

          .profile-main-info {
            padding-top: 0;
          }

          .profile-inline-meta {
            display: grid;
            grid-template-columns: 1fr;
            gap: 8px;
          }

          .profile-mini-row,
          .profile-field-grid,
          .profile-edit-grid,
          .profile-edit-grid .span-3 {
            grid-template-columns: 1fr;
            grid-column: auto;
          }

          .profile-mini-item {
            border-right: 0;
            border-bottom: 1px solid #eef2f7;
            padding: 11px 16px;
          }

          .profile-mini-item:last-child {
            border-bottom: 0;
          }

          .profile-section-head,
          .profile-edit-title {
            align-items: stretch;
            flex-direction: column;
          }

          .profile-media-btn,
          .profile-send-btn,
          .profile-edit-mini,
          .profile-form-actions button,
          .profile-password-card button {
            width: 100%;
            justify-content: center;
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
              +
              <input
                type="file"
                accept="image/*"
                disabled={photoSaving}
                onChange={handlePhotoFileChange}
              />
            </label>
          </div>

          <div className="profile-main-info">
            <h1>{mainName}</h1>
            <p>{mainRole}</p>

            <div className="profile-inline-meta">
              <span><MailIcon />{firstValue(employee.email, employee.official_email, user.email, '—')}</span>
              <span><PhoneIcon />{firstValue(employee.phone, employee.mobile, '—')}</span>
              <span>{firstValue(employee.employee_id, employee.emp_code, employee.employee_code, '—')}</span>
              <span>{firstValue(employee.location, employee.branch, employee.state, '—')}</span>
            </div>

            {hydrating ? (
              <div className="profile-loading-note">Refreshing latest profile data...</div>
            ) : null}
          </div>

          <button type="button" className="profile-send-btn" onClick={() => setEditing(true)}>
            <EditIcon />
            Edit Profile
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
                {profileSaving ? 'Saving...' : 'Save Profile'}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <div className="profile-card-grid">
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
        <h3>Request Password Change</h3>
        <p>Your request will be sent to Super Admin for approval.</p>

        <form className="dynamic-form" onSubmit={submit} noValidate>
          <label>
            Current Password
            <input
              type="password"
              value={form.current_password}
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
              onChange={(e) =>
                setForm({ ...form, confirm_password: e.target.value })
              }
            />
          </label>

          <button type="submit" className="primary" disabled={submitting}>
            {submitting ? 'Submitting...' : 'Send Approval Request'}
          </button>
        </form>
      </section>
    </div>
  );
}
