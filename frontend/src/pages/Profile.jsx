import { useMemo, useState } from 'react';
import {
  currentUser,
  currentEmployee,
  api,
  getInitials,
  getProfilePhotoUrl,
  refreshCurrentSession,
  buildProfilePhotoPayload,
} from '../api/client';

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

  return labels.length ? labels.join(' + ') : 'No additional capability mapped';
}

function employeeId(employee = {}) {
  return employee._id || employee.employee_id_for_edit || employee.employee_ref_id || '';
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

      <div>
        <strong>{name}</strong>
        <small>{employee.designation || 'Employee'}</small>
      </div>
    </div>
  );
}

function ProfileTable({ title, rows }) {
  return (
    <section className="panel">
      <h3>{title}</h3>

      <div className="table-wrap">
        <table>
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label}>
                <th>{label}</th>
                <td>{displayValue(value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function Profile() {
  const [user, setUser] = useState(currentUser());
  const [employee, setEmployee] = useState(currentEmployee());

  const userRoles = normalizeRoles(user);
  const initialPhoto = profilePhotoValue(employee) || profilePhotoValue(user);

  const [photo, setPhoto] = useState(initialPhoto);
  const [photoMessage, setPhotoMessage] = useState('');
  const [photoSaving, setPhotoSaving] = useState(false);

  const [form, setForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  });

  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const mainName = user.name || employee.name || user.email || 'My Profile';
  const mainRole = 'Employee';
  const capabilities = capabilityLabel(employee, userRoles);
  const previewPhotoUrl = photo ? getProfilePhotoUrl({ avatar: photo }) : '';

  const profileRows = useMemo(() => {
    return [
      ['Profile Photo', photo ? 'Uploaded / Available' : 'Not uploaded'],
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
    ['Speak Language', employee.speak_language || ''],
    ['Address', employee.address || ''],
  ];

  const employmentRows = [
    ['Employee ID', employee.employee_id || ''],
    ['Employee Code', employee.emp_code || ''],
    ['Tenant', user.tenant_id || employee.tenant_id || ''],
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
    ['Are Parents Senior Citizen?', boolLabel(employee.are_parents_senior_citizen)],
    ['Number of Children', employee.number_of_children || ''],
    ['No. of Children in Hostel', employee.children_in_hostel || ''],
    ['Disability Level', employee.disability_level || ''],
    ['Dependent Disability Level', employee.dependent_disability_level || ''],
  ];

  const previousEmploymentRows = [
    ['Previous Employer Name', employee.previous_employer_name || ''],
    ['Previous Designation', employee.previous_designation || ''],
    [
      'Previous Employment Tenure From Date',
      employee.previous_employment_tenure_from_date || '',
    ],
    [
      'Previous Employment Tenure End Date',
      employee.previous_employment_tenure_end_date || '',
    ],
  ];

  const reportingRows = [
    ['Team Leader Capability', boolLabel(employee.is_team_leader)],
    ['Reporting Officer Capability', boolLabel(employee.is_reporting_officer)],
    ['Mapped Team Leader ID', employee.team_leader_id || ''],
    ['Mapped Team Leader Name', employee.team_leader_name || ''],
    ['Mapped Reporting Officer ID', employee.reporting_officer_id || ''],
    ['Mapped Reporting Officer Name', employee.reporting_officer_name || ''],
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
      }

      return data;
    } catch {
      return null;
    }
  }

  function updatePhotoValue(value) {
    const nextPhoto = String(value || '').trim();

    setPhoto(nextPhoto);

    if (isUnsafePhotoValue(nextPhoto)) {
      setPhotoMessage(
        'This photo value is too large. Please save only a short uploaded image path or URL, not base64 image data.',
      );
      return;
    }

    setPhotoMessage('');
  }

  function handlePhotoFileChange(event) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      setPhotoMessage('Please choose an image file.');
      event.target.value = '';
      return;
    }

    event.target.value = '';

    setPhotoMessage(
      'Direct browser image upload is disabled here to prevent dashboard crashes. Upload the file to your server/uploads folder first, then paste the saved image path or URL here.',
    );
  }

  async function saveProfilePhoto() {
    const empId = employeeId(employee);
    const cleanPhoto = String(photo || '').trim();

    if (!empId) {
      setPhotoMessage('Employee profile id not found. Please ask HR/Admin to sync your employee profile.');
      return;
    }

    if (isUnsafePhotoValue(cleanPhoto)) {
      setPhotoMessage(
        'This image value is too large/base64 and cannot be saved because it can crash the dashboard. Please paste a saved image URL/path instead.',
      );
      return;
    }

    setPhotoMessage('');

    try {
      setPhotoSaving(true);

      await api(`/employees/${empId}`, {
        method: 'PATCH',
        body: JSON.stringify(buildProfilePhotoPayload(cleanPhoto)),
      });

      await refreshProfileSession();

      window.dispatchEvent(new Event('sds_hrms_profile_photo_updated'));

      setPhotoMessage('Profile photo updated successfully.');
    } catch (error) {
      setPhotoMessage(error.message || 'Unable to update profile photo.');
    } finally {
      setPhotoSaving(false);
    }
  }

  async function submit(e) {
    e.preventDefault();
    setMessage('');

    if (!form.current_password.trim()) {
      setMessage('Current password is required');
      return;
    }

    if (!form.new_password || form.new_password.length < 6) {
      setMessage('New password must be at least 6 characters');
      return;
    }

    if (form.new_password !== form.confirm_password) {
      setMessage('New password and confirm password do not match');
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

      setMessage(data.message || 'Password change request submitted');

      setForm({
        current_password: '',
        new_password: '',
        confirm_password: '',
      });
    } catch (error) {
      setMessage(error.message || 'Unable to submit password change request');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page-grid profile-page">
      <style>{`
        .profile-page .profile-hero-grid {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 18px;
          align-items: center;
        }

        .profile-avatar-card {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 14px;
          align-items: center;
        }

        .profile-avatar-card strong {
          display: block;
          color: var(--ink);
          font-size: 16px;
          line-height: 1.2;
        }

        .profile-avatar-card small {
          display: block;
          margin-top: 4px;
          color: var(--muted);
          font-weight: 700;
        }

        .profile-avatar-frame {
          width: 94px;
          height: 94px;
          overflow: hidden;
          border-radius: 28px;
          display: grid;
          place-items: center;
          background: linear-gradient(135deg, #eef2ff, #ecfdf5);
          color: var(--primary);
          border: 4px solid #ffffff;
          box-shadow: 0 18px 42px rgba(15, 23, 42, .14);
          font-size: 26px;
          font-weight: 900;
          flex: 0 0 auto;
        }

        .profile-avatar-frame img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .profile-photo-panel {
          display: grid;
          grid-template-columns: 120px minmax(0, 1fr);
          gap: 18px;
          align-items: center;
          border: 1px solid var(--line);
          border-radius: 24px;
          background:
            radial-gradient(circle at 0% 0%, rgba(79,70,229,.08), transparent 32%),
            #f8fafc;
          padding: 16px;
        }

        .profile-photo-preview {
          width: 112px;
          height: 112px;
          border-radius: 30px;
          overflow: hidden;
          display: grid;
          place-items: center;
          background: linear-gradient(135deg, #eef2ff, #ecfdf5);
          border: 4px solid #ffffff;
          box-shadow: 0 18px 42px rgba(15, 23, 42, .14);
          color: var(--primary);
          font-size: 28px;
          font-weight: 900;
        }

        .profile-photo-preview img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .profile-photo-controls {
          display: grid;
          gap: 10px;
          min-width: 0;
        }

        .profile-photo-controls input[type="text"] {
          width: 100%;
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
          color: var(--primary);
          padding: 10px 14px;
          font-weight: 800;
          cursor: pointer;
        }

        .profile-file-btn input {
          display: none;
        }

        .profile-photo-controls small {
          color: var(--muted);
          line-height: 1.5;
        }

        @media (max-width: 760px) {
          .profile-page .profile-hero-grid,
          .profile-photo-panel {
            grid-template-columns: 1fr;
          }

          .profile-avatar-frame,
          .profile-photo-preview {
            width: 84px;
            height: 84px;
            border-radius: 24px;
          }
        }
      `}</style>

      <section className="hero compact">
        <div className="profile-hero-grid">
          <ProfileAvatar user={user} employee={employee} photoValue={photo} />

          <div>
            <span className="kicker">My Profile</span>

            <h1>{mainName}</h1>

            <p>
              {mainRole}
              {capabilities !== 'No additional capability mapped'
                ? ` • ${capabilities}`
                : ''}
              {user.tenant_id || employee.tenant_id
                ? ` • ${user.tenant_id || employee.tenant_id}`
                : ''}
            </p>
          </div>
        </div>
      </section>

      <section className="panel">
        <h3>Profile Photo</h3>
        <p>
          Paste your saved photo URL/path. This photo will show in your profile,
          dashboard, topbar, project cards, team hierarchy and Super Admin User Control.
        </p>

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
              placeholder="/uploads/profile_photos/employee-photo.jpg"
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
              Save only a short server path or URL. Do not save base64 image data,
              because it can make dashboard APIs too large and crash Team Leader dashboards.
            </small>

            {photoMessage && <div className="inline-message">{photoMessage}</div>}
          </div>
        </div>
      </section>

      <ProfileTable title="Profile Summary" rows={profileRows} />

      <ProfileTable title="Personal Details" rows={personalRows} />

      <ProfileTable title="Employment Details" rows={employmentRows} />

      <ProfileTable title="Salary & Statutory Details" rows={salaryAndStatutoryRows} />

      <ProfileTable title="Family & Disability Details" rows={familyAndDisabilityRows} />

      <ProfileTable title="Previous Employment Details" rows={previousEmploymentRows} />

      <ProfileTable title="Reporting Hierarchy" rows={reportingRows} />

      <section className="panel">
        <h3>Request Password Change</h3>
        <p>Your request will be sent to Super Admin for approval.</p>

        <form className="dynamic-form" onSubmit={submit}>
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

        {message && <div className="inline-message">{message}</div>}
      </section>
    </div>
  );
}