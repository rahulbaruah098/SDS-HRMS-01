import { useMemo, useState } from 'react';
import {
  currentUser,
  currentEmployee,
  api,
  getInitials,
  getProfilePhotoUrl,
  refreshCurrentSession,
  buildProfilePhotoPayload,
  uploadEmployeeProfilePhoto,
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

function isUnsafePhotoValue(value = '') {
  const photo = String(value || '').trim();

  if (!photo) {
    return false;
  }

  if (photo.startsWith('data:image') && photo.length > 5000) {
    return true;
  }

  if (photo.length > 1000 && !photo.startsWith('http')) {
    return true;
  }

  return false;
}

function cleanPhotoValue(value = '') {
  const photo = String(value || '').trim();

  if (!photo || isUnsafePhotoValue(photo)) {
    return '';
  }

  return photo;
}

function profilePhotoValue(record = {}) {
  return (
    cleanPhotoValue(record.avatar) ||
    cleanPhotoValue(record.profile_photo) ||
    cleanPhotoValue(record.profile_picture) ||
    cleanPhotoValue(record.photo) ||
    cleanPhotoValue(record.image) ||
    cleanPhotoValue(record.picture) ||
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
  return employee._id || employee.employee_id_for_edit || employee.employee_ref_id || '';
}

function DetailIcon({ label = '' }) {
  const first = String(label || 'I').trim().charAt(0).toUpperCase() || 'I';

  return <span className="profile-detail-icon">{first}</span>;
}

function ProfileAvatar({ user = {}, employee = {}, photoValue = '' }) {
  const name = user.name || employee.name || user.email || 'Employee';
  const photo = cleanPhotoValue(photoValue) || profilePhotoValue(employee) || profilePhotoValue(user);
  const photoUrl = photo ? getProfilePhotoUrl({ avatar: photo }) : '';

  return (
    <div className="profile-avatar-card">
      <div className="profile-avatar-frame">
        {photoUrl ? (
          <img src={photoUrl} alt={name} />
        ) : (
          <span>{getInitials(name)}</span>
        )}
      </div>

      <div className="profile-avatar-meta">
        <strong>{name}</strong>
        <small>{employee.designation || 'Employee'}</small>
      </div>
    </div>
  );
}

function ProfileTable({ title, subtitle = '', rows }) {
  const visibleRows = rows.filter(([label]) => label);

  return (
    <section className="profile-card">
      <div className="profile-section-head">
        <div>
          <span className="profile-section-kicker">Employee Record</span>
          <h3>{title}</h3>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </div>

      <div className="profile-detail-grid">
        {visibleRows.map(([label, value]) => (
          <div className="profile-detail-card" key={label}>
            <DetailIcon label={label} />
            <div>
              <span>{label}</span>
              <strong>{displayValue(value)}</strong>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function Profile() {
  const alerts = useCustomAlert();

  const [user, setUser] = useState(currentUser());
  const [employee, setEmployee] = useState(currentEmployee());

  const userRoles = normalizeRoles(user);
  const initialPhoto = profilePhotoValue(employee) || profilePhotoValue(user);

  const [photo, setPhoto] = useState(initialPhoto);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoSaving, setPhotoSaving] = useState(false);

  const [form, setForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  });

  const [submitting, setSubmitting] = useState(false);

  const mainName = user.name || employee.name || user.email || 'My Profile';
  const mainRole = 'Employee';
  const capabilities = capabilityLabel(employee, userRoles);
  const previewPhotoUrl = photo ? getProfilePhotoUrl({ avatar: photo }) : '';

  const profileRows = useMemo(() => {
    return [
      ['Photo Status', photo ? 'Uploaded' : 'Not uploaded'],
      ['Name', user.name || employee.name || ''],
      ['Email', user.email || employee.email || ''],
      ['Phone', employee.phone || ''],
      ['Employee ID', employee.employee_id || employee.emp_code || ''],
      ['Department', employee.department || ''],
      ['Designation', employee.designation || ''],
    ];
  }, [employee, photo, user]);

  const personalRows = [
    ['Name', user.name || employee.name || ''],
    ['Email', user.email || employee.email || ''],
    ['Phone', employee.phone || ''],
    ['Gender', employee.gender || ''],
    ['Date Of Birth', employee.date_of_birth || ''],
    ['Blood Group', employee.blood_group || ''],
    ["Father's Name", employee.father_name || ''],
    ['Religion', employee.religion || ''],
    ['Marital Status', employee.marital_status || ''],
    ['Language', employee.speak_language || ''],
    ['Address', employee.address || ''],
  ];

  const employmentRows = [
    ['Employee ID', employee.employee_id || ''],
    ['Employee Code', employee.emp_code || ''],
    ['Company / Tenant', user.tenant_id || employee.tenant_id || ''],
    ['Dashboard Role', mainRole],
    ['Login Access', userRoles.map(roleLabel).join(', ')],
    ['Employee Capability', capabilities],
    ['Profile Role', 'Employee'],
    ['Department', employee.department || ''],
    ['Designation', employee.designation || ''],
    ['Branch', employee.branch || ''],
    ['Shift', employee.shift || ''],
    ['Joining Date', employee.joining_date || employee.doj || ''],
    ['Employee Type', employee.employee_type || employee.job_type || ''],
    ['Skill Level', employee.skill_level || ''],
    ['Employment Status', employee.employment_status || employee.status || ''],
    ['Project', employee.project || ''],
    ['State', employee.state || ''],
  ];

  const salaryAndStatutoryRows = [
    ['Gross Salary', employee.gross_salary || employee.salary || ''],
    ['Payment Mode', employee.payment_mode || ''],
    ['PAN No', employee.pan_no || ''],
    ['Aadhar No', employee.aadhar_no || ''],
    ['Employee UAN No', employee.employee_uan_no || ''],
    ['Employee ESIC IP', employee.employee_esic_ip || ''],
  ];

  const familyAndDisabilityRows = [
    ['Parents Senior Citizen?', boolLabel(employee.are_parents_senior_citizen)],
    ['Number of Children', employee.number_of_children || ''],
    ['Children in Hostel', employee.children_in_hostel || ''],
    ['Disability Level', employee.disability_level || ''],
    ['Dependent Disability Level', employee.dependent_disability_level || ''],
  ];

  const previousEmploymentRows = [
    ['Previous Employer Name', employee.previous_employer_name || ''],
    ['Previous Designation', employee.previous_designation || ''],
    [
      'Previous Employment From Date',
      employee.previous_employment_tenure_from_date || '',
    ],
    [
      'Previous Employment End Date',
      employee.previous_employment_tenure_end_date || '',
    ],
  ];

  const reportingRows = [
    ['Team Leader Capability', boolLabel(employee.is_team_leader)],
    ['Reporting Officer Capability', boolLabel(employee.is_reporting_officer)],
    ['Team Leader ID', employee.team_leader_id || ''],
    ['Team Leader Name', employee.team_leader_name || ''],
    ['Reporting Officer ID', employee.reporting_officer_id || ''],
    ['Reporting Officer Name', employee.reporting_officer_name || ''],
  ];

  async function refreshProfileSession() {
    try {
      const data = await refreshCurrentSession();

      if (data.user) {
        setUser(data.user);
      }

      if (data.employee) {
        setEmployee(data.employee);
        setPhoto(profilePhotoValue(data.employee) || profilePhotoValue(data.user));
        setPhotoFile(null);
      }

      return data;
    } catch {
      return null;
    }
  }

  function updatePhotoValue(value) {
    const nextPhoto = String(value || '').trim();

    setPhoto(nextPhoto);
    setPhotoFile(null);
  }

  function handlePhotoFileChange(event) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      setPhotoFile(null);
      event.target.value = '';
      alerts.warning('Please choose a valid image file.', 'Invalid File');
      return;
    }

    if (file.size > 1024 * 1024 * 2) {
      setPhotoFile(null);
      event.target.value = '';
      alerts.warning('Image size should be below 2MB.', 'File Too Large');
      return;
    }

    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

    if (!allowedTypes.includes(file.type.toLowerCase())) {
      setPhotoFile(null);
      event.target.value = '';
      alerts.warning('Only JPG, JPEG, PNG, and WEBP images are allowed.', 'Unsupported Image');
      return;
    }

    setPhotoFile(file);
    alerts.info(`${file.name} is ready. Click Save Photo to upload.`, 'Photo Selected');
  }

  async function saveProfilePhoto() {
    const empId = employeeId(employee);
    const cleanPhoto = String(photo || '').trim();

    if (!empId) {
      alerts.error(
        'Employee profile ID was not found. Please ask HR/Admin to sync your employee profile.',
        'Profile Not Linked',
      );
      return;
    }

    try {
      setPhotoSaving(true);

      if (photoFile) {
        const data = await uploadEmployeeProfilePhoto(empId, photoFile);
        const uploadedPhoto = data.photo || data.photo_url || '';

        if (uploadedPhoto) {
          setPhoto(uploadedPhoto);
        }

        setPhotoFile(null);
      } else {
        if (isUnsafePhotoValue(cleanPhoto)) {
          alerts.warning(
            'This image value is too large/base64 and cannot be saved because it can slow down the dashboard. Please upload a photo file or paste a saved image URL/path.',
            'Photo Value Too Large',
          );
          return;
        }

        await api(`/employees/${empId}`, {
          method: 'PATCH',
          body: JSON.stringify(buildProfilePhotoPayload(cleanPhoto)),
        });
      }

      await refreshProfileSession();

      window.dispatchEvent(new Event('sds_hrms_profile_photo_updated'));

      alerts.success('Profile photo updated successfully.', 'Photo Saved');
    } catch (error) {
      alerts.error(error.message || 'Unable to update profile photo.', 'Photo Update Failed');
    } finally {
      setPhotoSaving(false);
    }
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
    <div className="page-grid profile-page">
      <style>{`
        .profile-page {
          display: grid;
          gap: 22px;
        }

        .profile-page .profile-hero {
          position: relative;
          overflow: hidden;
          border: 1px solid rgba(226, 232, 240, 0.9);
          border-radius: 34px;
          padding: 28px;
          background:
            radial-gradient(circle at 12% 8%, rgba(79,70,229,.18), transparent 34%),
            radial-gradient(circle at 86% 0%, rgba(14,165,233,.14), transparent 32%),
            radial-gradient(circle at 80% 92%, rgba(5,150,105,.12), transparent 35%),
            linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
          box-shadow: 0 22px 60px rgba(15, 23, 42, .08);
        }

        .profile-hero::after {
          content: "";
          position: absolute;
          width: 260px;
          height: 260px;
          right: -90px;
          top: -90px;
          border-radius: 999px;
          background: rgba(79, 70, 229, .08);
          pointer-events: none;
        }

        .profile-hero-grid {
          position: relative;
          z-index: 1;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          gap: 22px;
          align-items: center;
        }

        .profile-avatar-card {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 16px;
          align-items: center;
          min-width: 0;
        }

        .profile-avatar-meta {
          min-width: 0;
        }

        .profile-avatar-card strong {
          display: block;
          color: #0f172a;
          font-size: 18px;
          line-height: 1.2;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .profile-avatar-card small {
          display: block;
          margin-top: 5px;
          color: #64748b;
          font-weight: 800;
        }

        .profile-avatar-frame {
          width: 104px;
          height: 104px;
          overflow: hidden;
          border-radius: 32px;
          display: grid;
          place-items: center;
          background: linear-gradient(135deg, #eef2ff, #ecfdf5);
          color: #4f46e5;
          border: 4px solid #ffffff;
          box-shadow: 0 18px 42px rgba(15, 23, 42, .14);
          font-size: 28px;
          font-weight: 950;
          flex: 0 0 auto;
        }

        .profile-avatar-frame img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .profile-identity h1 {
          margin: 8px 0 8px;
          color: #0f172a;
          font-size: clamp(28px, 4vw, 42px);
          line-height: 1.05;
          letter-spacing: -0.045em;
        }

        .profile-identity p {
          margin: 0;
          color: #475569;
          line-height: 1.55;
          max-width: 720px;
        }

        .profile-chip-row {
          display: flex;
          flex-wrap: wrap;
          gap: 9px;
          margin-top: 14px;
        }

        .profile-chip {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          border-radius: 999px;
          padding: 8px 12px;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          color: #334155;
          font-size: 12px;
          font-weight: 900;
          box-shadow: 0 10px 22px rgba(15, 23, 42, .05);
        }

        .profile-chip.primary {
          background: #eef2ff;
          border-color: #c7d2fe;
          color: #4338ca;
        }

        .profile-chip.success {
          background: #ecfdf5;
          border-color: #bbf7d0;
          color: #047857;
        }

        .profile-hero-stat {
          min-width: 185px;
          border-radius: 24px;
          padding: 18px;
          background: rgba(255, 255, 255, .78);
          border: 1px solid rgba(226, 232, 240, .95);
          box-shadow: 0 16px 38px rgba(15, 23, 42, .06);
        }

        .profile-hero-stat span {
          display: block;
          color: #64748b;
          font-size: 12px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: .06em;
        }

        .profile-hero-stat strong {
          display: block;
          margin-top: 7px;
          color: #0f172a;
          font-size: 19px;
          line-height: 1.25;
        }

        .profile-card {
          border: 1px solid #e2e8f0;
          border-radius: 28px;
          background: #ffffff;
          box-shadow: 0 18px 48px rgba(15, 23, 42, .06);
          padding: 22px;
        }

        .profile-section-head {
          display: flex;
          justify-content: space-between;
          gap: 18px;
          align-items: flex-start;
          margin-bottom: 16px;
          padding-bottom: 14px;
          border-bottom: 1px solid #edf2f7;
        }

        .profile-section-kicker {
          display: inline-flex;
          width: fit-content;
          border-radius: 999px;
          padding: 6px 10px;
          background: #eef2ff;
          color: #4f46e5;
          font-size: 11px;
          font-weight: 950;
          text-transform: uppercase;
          letter-spacing: .08em;
          margin-bottom: 8px;
        }

        .profile-section-head h3 {
          margin: 0;
          color: #0f172a;
          font-size: 20px;
          letter-spacing: -0.02em;
        }

        .profile-section-head p {
          margin: 6px 0 0;
          color: #64748b;
          line-height: 1.55;
          font-size: 13px;
        }

        .profile-detail-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
        }

        .profile-detail-card {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 11px;
          align-items: start;
          min-height: 84px;
          border: 1px solid #e8eef7;
          border-radius: 20px;
          background:
            radial-gradient(circle at 0% 0%, rgba(79,70,229,.05), transparent 40%),
            #f8fafc;
          padding: 14px;
          transition: .18s ease;
        }

        .profile-detail-card:hover {
          transform: translateY(-1px);
          border-color: #c7d2fe;
          background: #ffffff;
          box-shadow: 0 14px 30px rgba(15, 23, 42, .06);
        }

        .profile-detail-icon {
          width: 34px;
          height: 34px;
          border-radius: 13px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: #eef2ff;
          color: #4f46e5;
          font-size: 13px;
          font-weight: 950;
        }

        .profile-detail-card span {
          display: block;
          color: #64748b;
          font-size: 12px;
          font-weight: 900;
          margin-bottom: 5px;
        }

        .profile-detail-card strong {
          display: block;
          color: #0f172a;
          font-size: 14px;
          line-height: 1.45;
          word-break: break-word;
        }

        .profile-photo-panel {
          display: grid;
          grid-template-columns: 136px minmax(0, 1fr);
          gap: 20px;
          align-items: center;
          border: 1px solid #e2e8f0;
          border-radius: 24px;
          background:
            radial-gradient(circle at 0% 0%, rgba(79,70,229,.08), transparent 32%),
            linear-gradient(135deg, #f8fafc, #ffffff);
          padding: 18px;
        }

        .profile-photo-preview {
          width: 124px;
          height: 124px;
          border-radius: 34px;
          overflow: hidden;
          display: grid;
          place-items: center;
          background: linear-gradient(135deg, #eef2ff, #ecfdf5);
          border: 4px solid #ffffff;
          box-shadow: 0 18px 42px rgba(15, 23, 42, .14);
          color: #4f46e5;
          font-size: 30px;
          font-weight: 950;
        }

        .profile-photo-preview img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .profile-photo-controls {
          display: grid;
          gap: 12px;
          min-width: 0;
        }

        .profile-photo-controls input[type="text"] {
          width: 100%;
          border: 1px solid #dbe4f0;
          border-radius: 16px;
          background: #ffffff;
          color: #0f172a;
          padding: 12px 14px;
          outline: none;
          transition: .18s ease;
        }

        .profile-photo-controls input[type="text"]:focus {
          border-color: #4f46e5;
          box-shadow: 0 0 0 4px rgba(79, 70, 229, .12);
        }

        .profile-photo-actions {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 10px;
        }

        .profile-file-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          border-radius: 999px;
          background: #eef2ff;
          color: #4f46e5;
          padding: 10px 14px;
          font-weight: 900;
          cursor: pointer;
          border: 1px solid #c7d2fe;
        }

        .profile-file-btn input {
          display: none;
        }

        .profile-photo-controls small,
        .profile-help-text {
          color: #64748b;
          line-height: 1.5;
          font-size: 13px;
        }

        .profile-selected-file {
          width: fit-content;
          border-radius: 999px;
          padding: 8px 12px;
          background: #ecfdf5;
          color: #047857;
          border: 1px solid #bbf7d0;
          font-size: 12px;
          font-weight: 900;
        }

        .profile-password-card form {
          margin-top: 8px;
        }

        .profile-password-card input {
          border-radius: 16px;
        }

        @media (max-width: 1100px) {
          .profile-hero-grid {
            grid-template-columns: 1fr;
          }

          .profile-hero-stat {
            min-width: 0;
            width: fit-content;
          }

          .profile-detail-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 760px) {
          .profile-page .profile-hero,
          .profile-card {
            border-radius: 24px;
            padding: 18px;
          }

          .profile-detail-grid,
          .profile-photo-panel {
            grid-template-columns: 1fr;
          }

          .profile-avatar-frame,
          .profile-photo-preview {
            width: 88px;
            height: 88px;
            border-radius: 26px;
          }

          .profile-hero-stat {
            width: 100%;
          }

          .profile-photo-actions button,
          .profile-file-btn {
            width: 100%;
          }
        }
      `}</style>

      <section className="profile-hero">
        <div className="profile-hero-grid">
          <ProfileAvatar user={user} employee={employee} photoValue={photo} />

          <div className="profile-identity">
            <span className="kicker">My Profile</span>

            <h1>{mainName}</h1>

            <p>
              A clean overview of your personal information, employment details,
              reporting structure and HRMS access.
            </p>

            <div className="profile-chip-row">
              <span className="profile-chip primary">{mainRole}</span>

              {capabilities !== 'No additional capability' ? (
                <span className="profile-chip success">{capabilities}</span>
              ) : null}

              {(user.tenant_id || employee.tenant_id) ? (
                <span className="profile-chip">{user.tenant_id || employee.tenant_id}</span>
              ) : null}

              {(employee.department || employee.designation) ? (
                <span className="profile-chip">
                  {[employee.department, employee.designation].filter(Boolean).join(' • ')}
                </span>
              ) : null}
            </div>
          </div>

          <div className="profile-hero-stat">
            <span>Employee Code</span>
            <strong>{employee.employee_id || employee.emp_code || 'Not available'}</strong>
          </div>
        </div>
      </section>

      <section className="profile-card">
        <div className="profile-section-head">
          <div>
            <span className="profile-section-kicker">Photo</span>
            <h3>Profile Photo</h3>
            <p>
              Choose a clear professional photo. It appears in your profile,
              dashboard, topbar, project cards, team hierarchy and Super Admin User Control.
            </p>
          </div>
        </div>

        <div className="profile-photo-panel">
          <div className="profile-photo-preview">
            {previewPhotoUrl ? (
              <img src={previewPhotoUrl} alt={mainName} />
            ) : (
              <span>{getInitials(mainName)}</span>
            )}
          </div>

          <div className="profile-photo-controls">
            <input
              type="text"
              value={photo}
              placeholder="Photo path will appear after upload"
              onChange={(event) => updatePhotoValue(event.target.value)}
            />

            <div className="profile-photo-actions">
              <label className="profile-file-btn">
                Choose Photo
                <input
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoFileChange}
                />
              </label>

              {photo && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => updatePhotoValue('')}
                  disabled={photoSaving}
                >
                  Remove
                </button>
              )}

              <button
                type="button"
                className="primary"
                onClick={saveProfilePhoto}
                disabled={photoSaving}
              >
                {photoSaving ? 'Saving...' : 'Save Photo'}
              </button>
            </div>

            <small>
              Accepted formats: JPG, JPEG, PNG and WEBP below 2MB. The backend stores
              the uploaded file safely and keeps only the image path in MongoDB.
            </small>

            {photoFile && (
              <div className="profile-selected-file">
                Ready to upload: {photoFile.name}
              </div>
            )}
          </div>
        </div>
      </section>

      <ProfileTable
        title="Profile Summary"
        subtitle="Quick view of your official identity and contact details."
        rows={profileRows}
      />

      <ProfileTable
        title="Personal Details"
        subtitle="Personal information maintained in your employee record."
        rows={personalRows}
      />

      <ProfileTable
        title="Employment Details"
        subtitle="Official role, department, branch and employment information."
        rows={employmentRows}
      />

      <ProfileTable
        title="Salary & Statutory Details"
        subtitle="Salary, payment and statutory identification information."
        rows={salaryAndStatutoryRows}
      />

      <ProfileTable
        title="Family & Disability Details"
        subtitle="Family-related and disability declaration details."
        rows={familyAndDisabilityRows}
      />

      <ProfileTable
        title="Previous Employment Details"
        subtitle="Past employment history saved in the employee record."
        rows={previousEmploymentRows}
      />

      <ProfileTable
        title="Reporting Hierarchy"
        subtitle="Your reporting structure and approval responsibilities."
        rows={reportingRows}
      />

      <section className="profile-card profile-password-card">
        <div className="profile-section-head">
          <div>
            <span className="profile-section-kicker">Security</span>
            <h3>Request Password Change</h3>
            <p>Your request will be sent to Super Admin for approval.</p>
          </div>
        </div>

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
