import { useEffect, useMemo, useState } from 'react';
import {
  createEmployee,
  createPastEmployee,
  downloadAlumniCsv,
  downloadEmployeeCsv,
  filterEmployees,
  getActiveEmployees,
  getActiveOrganisations,
  getAlumniEmployees,
  getEmployeeFormOptions,
  getReportingOfficerOptions,
  getTeamLeaderOptions,
  markEmployeeAsResigned,
  updateEmployee,
} from '../api/client';

const EMPTY_EMPLOYEE_FORM = {
  name: '',
  employee_name: '',
  email: '',
  official_email: '',

  avatar: '',
  profile_photo: '',
  profile_picture: '',
  photo: '',

  phone: '',
  mobile: '',
  country: 'Bangladesh',
  joining_date: '',
  date_of_joining: '',
  date_of_birth: '',
  blood_group: '',
  gross_salary: '',
  branch: 'Assam/Guwahati (HO)',
  state: '',
  aadhar_no: '',
  employee_uan_no: '',
  employee_type: 'Full Time',
  skill_level: '',
  are_parents_senior_citizen: 'false',
  number_of_children: '',
  payment_mode: 'Bank Transfer',
  previous_designation: '',
  previous_employment_tenure_end_date: '',
  password: '12345678',
  password_mode: 'default',

  role: 'employee',

  organisation_id: '',
  organisation: '',
  organisation_code: '',
  organization_id: '',
  organization: '',
  organization_code: '',

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
  employment_status: 'active',
  father_name: '',
  dependent_disability_level: 'No Disability',
  children_in_hostel: '',
  previous_employer_name: '',
  previous_employment_tenure_from_date: '',
  employee_id: '',
  emp_code: '',
  employee_code: '',
  job_type: 'Permanent',
  salary: 0,
  status: 'active',

  is_alumni: false,
  skip_login: false,
  last_working_date: '',
  resignation_date: '',
  resignation_reason: '',
  exit_type: '',

  is_team_leader: false,
  is_reporting_officer: false,
  is_it_support_head: false,
  is_it_support_member: false,

  team_leader_id: '',
  team_leader_name: '',
  reporting_officer_id: '',
  reporting_officer_name: '',
};

const EMPTY_ALUMNI_FORM = {
  ...EMPTY_EMPLOYEE_FORM,
  password: '',
  password_mode: '',
  is_alumni: true,
  skip_login: true,
  status: 'Resigned',
  employment_status: 'Resigned',
  exit_type: 'Resigned',
  last_working_date: '',
  resignation_date: '',
  resignation_reason: '',
};

const EMPTY_RESIGN_FORM = {
  last_working_date: '',
  resignation_date: '',
  resignation_reason: '',
  exit_type: 'Resigned',
};

const ROLE_OPTIONS = [
  { value: 'employee', label: 'Employee' },
  { value: 'manager', label: 'Manager' },
  { value: 'hr', label: 'HR' },
  { value: 'hr_manager', label: 'HR Manager' },
  { value: 'hr_admin', label: 'HR Admin' },
  { value: 'admin', label: 'Admin' },
  { value: 'finance', label: 'Finance' },
  { value: 'accounts_finance', label: 'Accounts Finance' },
];

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'probation', label: 'Probation' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'Resigned', label: 'Resigned' },
  { value: 'Left', label: 'Left' },
  { value: 'Terminated', label: 'Terminated' },
  { value: 'Retired', label: 'Retired' },
];

const EMPLOYEE_TYPE_OPTIONS = [
  { value: 'Full Time', label: 'Full Time' },
  { value: 'Part Time', label: 'Part Time' },
  { value: 'Contract', label: 'Contract' },
  { value: 'Intern', label: 'Intern' },
];

const JOB_TYPE_OPTIONS = [
  { value: 'Permanent', label: 'Permanent' },
  { value: 'Probation', label: 'Probation' },
  { value: 'Temporary', label: 'Temporary' },
  { value: 'Consultant', label: 'Consultant' },
  { value: 'Regular', label: 'Regular' },
];

const EXIT_TYPE_OPTIONS = [
  { value: 'Resigned', label: 'Resigned' },
  { value: 'Terminated', label: 'Terminated' },
  { value: 'Retired', label: 'Retired' },
  { value: 'Absconded', label: 'Absconded' },
  { value: 'Other', label: 'Other' },
];

const TRUE_FALSE_OPTIONS = [
  { value: 'false', label: 'No' },
  { value: 'true', label: 'Yes' },
];

const BLOOD_GROUP_OPTIONS = [
  { value: '', label: 'Choose One' },
  { value: 'A+', label: 'A+' },
  { value: 'A-', label: 'A-' },
  { value: 'B+', label: 'B+' },
  { value: 'B-', label: 'B-' },
  { value: 'AB+', label: 'AB+' },
  { value: 'AB-', label: 'AB-' },
  { value: 'O+', label: 'O+' },
  { value: 'O-', label: 'O-' },
];

const RELIGION_OPTIONS = [
  { value: '', label: 'Choose One' },
  { value: 'Hindu', label: 'Hindu' },
  { value: 'Muslim', label: 'Muslim' },
  { value: 'Christian', label: 'Christian' },
  { value: 'Sikh', label: 'Sikh' },
  { value: 'Buddhist', label: 'Buddhist' },
  { value: 'Jain', label: 'Jain' },
  { value: 'Other', label: 'Other' },
];

const SKILL_LEVEL_OPTIONS = [
  { value: '', label: 'Choose One' },
  { value: 'Unskilled', label: 'Unskilled' },
  { value: 'Semi Skilled', label: 'Semi Skilled' },
  { value: 'Skilled', label: 'Skilled' },
  { value: 'Highly Skilled', label: 'Highly Skilled' },
];

const DISABILITY_LEVEL_OPTIONS = [
  { value: 'No Disability', label: 'No Disability' },
  { value: 'Mild Disability', label: 'Mild Disability' },
  { value: 'Moderate Disability', label: 'Moderate Disability' },
  { value: 'Severe Disability', label: 'Severe Disability' },
];

const MARITAL_STATUS_OPTIONS = [
  { value: '', label: 'Choose One' },
  { value: 'Single', label: 'Single' },
  { value: 'Married', label: 'Married' },
  { value: 'Divorced', label: 'Divorced' },
  { value: 'Widowed', label: 'Widowed' },
];

const PAYMENT_MODE_OPTIONS = [
  { value: 'Cash', label: 'Cash' },
  { value: 'Bank Transfer', label: 'Bank Transfer' },
  { value: 'Cheque', label: 'Cheque' },
  { value: 'UPI', label: 'UPI' },
];

function normalizeDateValue(value) {
  if (!value) return '';

  try {
    return String(value).slice(0, 10);
  } catch {
    return '';
  }
}

function displayDate(value) {
  const normalized = normalizeDateValue(value);
  return normalized || '—';
}

function displayValue(value, fallback = '—') {
  const text = String(value || '').trim();
  return text || fallback;
}

function boolFormValue(value) {
  return ['true', 'yes', '1', 'on', true].includes(
    typeof value === 'boolean' ? value : String(value || '').trim().toLowerCase(),
  );
}

function uniqueOptions(rows = [], key) {
  return Array.from(
    new Set(
      rows
        .map((row) => String(row?.[key] || '').trim())
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b));
}

function optionText(option = {}) {
  return String(
    option.label ||
      option.name ||
      option.title ||
      option.organisation_name ||
      option.organization_name ||
      option.department_name ||
      option.designation_name ||
      option.state_name ||
      ''
  ).trim();
}

function masterOptions(items = [], placeholder = 'Choose One') {
  const rows = Array.isArray(items) ? items : [];
  const seen = new Set();
  const options = [{ value: '', label: placeholder }];

  rows.forEach((item) => {
    const label = optionText(item);
    if (!label || seen.has(label.toLowerCase())) return;

    seen.add(label.toLowerCase());
    options.push({ value: label, label });
  });

  return options;
}


function organisationOptions(items = []) {
  const rows = Array.isArray(items) ? items : [];

  return [
    { value: '', label: 'Choose Organisation / Entity' },
    ...rows.map((item) => {
      const id = item.id || item._id || '';
      const name =
        item.name ||
        item.organisation_name ||
        item.organization_name ||
        '';

      const code =
        item.code ||
        item.organisation_code ||
        item.organization_code ||
        '';

      return {
        value: id || code || name,
        label: code ? `${name} (${code})` : name,
        name,
        code,
        id,
      };
    }).filter((item) => item.label && item.value),
  ];
}

function employeeOptionLabel(employee = {}) {
  const name = employee.name || employee.employee_name || employee.full_name || employee.email || 'Employee';
  const code = employee.emp_code || employee.employee_code || employee.employee_id || '';
  const designation = employee.designation || employee.designation_name || '';
  const department = employee.department || employee.department_name || '';

  return [
    name,
    code ? `(${code})` : '',
    designation ? `- ${designation}` : '',
    department ? `, ${department}` : '',
  ].filter(Boolean).join(' ');
}

function employeeOptionId(employee = {}) {
  return employee._id || employee.id || employee.employee_ref_id || '';
}

function employeeOptionName(employee = {}) {
  return employee.name || employee.employee_name || employee.full_name || employee.email || '';
}

function searchableEmployeeOptions(rows = [], searchText = '') {
  const query = String(searchText || '').trim().toLowerCase();

  return (Array.isArray(rows) ? rows : []).filter((employee) => {
    const label = employeeOptionLabel(employee).toLowerCase();
    const id = employeeOptionId(employee).toLowerCase();

    return !query || label.includes(query) || id.includes(query);
  });
}

function employeeRowId(employee = {}) {
  return employee._id || employee.id || '';
}

function normalizeEmployeeForForm(employee = {}) {
  const merged = {
    ...EMPTY_EMPLOYEE_FORM,
    ...employee,
  };

  merged.name = merged.name || merged.employee_name || '';
  merged.employee_name = merged.employee_name || merged.name || '';
  merged.email = merged.email || merged.official_email || '';
  merged.official_email = merged.official_email || merged.email || '';
  merged.phone = merged.phone || merged.mobile || '';
  merged.mobile = merged.mobile || merged.phone || '';
  merged.employee_id = merged.employee_id || merged.employee_code || merged.emp_code || '';
  merged.emp_code = merged.emp_code || merged.employee_code || merged.employee_id || '';
  merged.employee_code = merged.employee_code || merged.emp_code || merged.employee_id || '';
  merged.organisation_id = merged.organisation_id || merged.organization_id || '';
  merged.organization_id = merged.organization_id || merged.organisation_id || '';
  merged.organisation = merged.organisation || merged.organization || '';
  merged.organization = merged.organization || merged.organisation || '';
  merged.organisation_code = merged.organisation_code || merged.organization_code || '';
  merged.organization_code = merged.organization_code || merged.organisation_code || '';
  merged.joining_date = normalizeDateValue(merged.joining_date || merged.date_of_joining);
  merged.date_of_joining = normalizeDateValue(merged.date_of_joining || merged.joining_date);
  merged.date_of_birth = normalizeDateValue(merged.date_of_birth || merged.dob);
  merged.previous_employment_tenure_from_date = normalizeDateValue(merged.previous_employment_tenure_from_date);
  merged.previous_employment_tenure_end_date = normalizeDateValue(merged.previous_employment_tenure_end_date);
  merged.last_working_date = normalizeDateValue(merged.last_working_date || merged.resignation_date);
  merged.resignation_date = normalizeDateValue(merged.resignation_date || merged.last_working_date);

  merged.is_team_leader = boolFormValue(merged.is_team_leader);
  merged.is_reporting_officer = boolFormValue(merged.is_reporting_officer);
  merged.is_it_support_head = boolFormValue(merged.is_it_support_head);
  merged.is_it_support_member = boolFormValue(merged.is_it_support_member);

  return merged;
}

function employeePayloadFromForm(form = {}, extra = {}) {
  const payload = {
    ...form,
    ...extra,
  };

  payload.name = payload.name || payload.employee_name || '';
  payload.employee_name = payload.employee_name || payload.name || '';
  payload.email = payload.email || payload.official_email || '';
  payload.official_email = payload.official_email || payload.email || '';
  payload.phone = payload.phone || payload.mobile || '';
  payload.mobile = payload.mobile || payload.phone || '';
  payload.employee_code = payload.employee_code || payload.emp_code || payload.employee_id || '';
  payload.emp_code = payload.emp_code || payload.employee_code || payload.employee_id || '';
  payload.employee_id = payload.employee_id || payload.emp_code || payload.employee_code || '';
  payload.organisation_id = payload.organisation_id || payload.organization_id || '';
  payload.organization_id = payload.organization_id || payload.organisation_id || '';
  payload.organisation = payload.organisation || payload.organization || '';
  payload.organization = payload.organization || payload.organisation || '';
  payload.organisation_code = payload.organisation_code || payload.organization_code || '';
  payload.organization_code = payload.organization_code || payload.organisation_code || '';
  payload.joining_date = payload.joining_date || payload.date_of_joining || '';
  payload.date_of_joining = payload.date_of_joining || payload.joining_date || '';
  payload.date_of_birth = payload.date_of_birth || payload.dob || '';
  payload.dob = payload.dob || payload.date_of_birth || '';

  payload.is_team_leader = boolFormValue(payload.is_team_leader);
  payload.is_reporting_officer = boolFormValue(payload.is_reporting_officer);
  payload.is_it_support_head = boolFormValue(payload.is_it_support_head);
  payload.is_it_support_member = boolFormValue(payload.is_it_support_member);

  return payload;
}

function EmployeeAvatar({ employee }) {
  const name = employee?.name || employee?.employee_name || 'Employee';
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || 'E';

  if (employee?.photo_url) {
    return (
      <img
        className="hrms-employee-avatar"
        src={employee.photo_url}
        alt={name}
      />
    );
  }

  return <span className="hrms-employee-avatar">{initials}</span>;
}

function TextInput({
  label,
  name,
  value,
  onChange,
  type = 'text',
  required = false,
  placeholder = '',
}) {
  return (
    <label className="hrms-field">
      <span>
        {label}
        {required ? <b>*</b> : null}
      </span>
      <input
        type={type}
        name={name}
        value={value ?? ''}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
      />
    </label>
  );
}

function SelectInput({
  label,
  name,
  value,
  onChange,
  options = [],
  required = false,
}) {
  return (
    <label className="hrms-field">
      <span>
        {label}
        {required ? <b>*</b> : null}
      </span>
      <select
        name={name}
        value={value ?? ''}
        onChange={onChange}
        required={required}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function CheckboxInput({ label, name, checked, onChange }) {
  return (
    <label className="hrms-checkbox">
      <input
        type="checkbox"
        name={name}
        checked={Boolean(checked)}
        onChange={onChange}
      />
      <span>{label}</span>
    </label>
  );
}

function FormSection({ title, children }) {
  return (
    <div className="hrms-form-section">
      <h4>{title}</h4>
      <div className="hrms-form-grid">{children}</div>
    </div>
  );
}

function SearchableEmployeeSelect({
  label,
  name,
  value,
  searchValue,
  onSearchChange,
  onChange,
  options = [],
  required = false,
  disabled = false,
  placeholder = 'Search employee...',
}) {
  const filteredOptions = searchableEmployeeOptions(options, searchValue);

  return (
    <label className="hrms-field hrms-searchable-field">
      <span>
        {label}
        {required ? <b>*</b> : null}
      </span>
      <input
        type="text"
        value={searchValue}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
      <select
        name={name}
        value={value ?? ''}
        onChange={onChange}
        required={required}
        disabled={disabled}
      >
        <option value="">Choose One</option>
        {filteredOptions.map((employee) => {
          const id = employeeOptionId(employee);
          return (
            <option key={id || employee.email || employeeOptionLabel(employee)} value={id}>
              {employeeOptionLabel(employee)}
            </option>
          );
        })}
      </select>
    </label>
  );
}

function EmployeeForm({
  title,
  subtitle,
  form,
  setForm,
  onSubmit,
  submitLabel,
  loading,
  isAlumniForm = false,
  isEdit = false,
  organisations = [],
  departments = [],
  designations = [],
  states = [],
  teamLeaders = [],
  reportingOfficers = [],
  teamLeaderSearch,
  setTeamLeaderSearch,
  reportingOfficerSearch,
  setReportingOfficerSearch,
}) {
  const entityOptions = organisationOptions(organisations);
  const departmentOptions = masterOptions(departments, 'Choose Department');
  const designationOptions = masterOptions(designations, 'Choose Designation');
  const stateOptions = masterOptions(states, 'Choose State');

  const setSelectedEmployeeMapping = (next, fieldName, selectedId) => {
    if (fieldName === 'team_leader_id') {
      const selected = teamLeaders.find((employee) => employeeOptionId(employee) === selectedId);
      next.team_leader_id = selectedId;
      next.team_leader_name = selected ? employeeOptionName(selected) : '';

      return next;
    }

    if (fieldName === 'reporting_officer_id') {
      const selected = reportingOfficers.find((employee) => employeeOptionId(employee) === selectedId);
      next.reporting_officer_id = selectedId;
      next.reporting_officer_name = selected ? employeeOptionName(selected) : '';

      return next;
    }

    return next;
  };

  const handleChange = (event) => {
    const { name, value, type, checked } = event.target;

    setForm((previous) => {
      const next = {
        ...previous,
        [name]: type === 'checkbox' ? checked : value,
      };

      if (name === 'name') next.employee_name = value;
      if (name === 'employee_name') next.name = value;
      if (name === 'email') next.official_email = previous.official_email || value;
      if (name === 'official_email') next.email = previous.email || value;
      if (name === 'phone') next.mobile = previous.mobile || value;
      if (name === 'mobile') next.phone = previous.phone || value;
      if (name === 'emp_code') next.employee_code = value;
      if (name === 'employee_code') next.emp_code = value;
      if (name === 'joining_date') next.date_of_joining = value;
      if (name === 'date_of_joining') next.joining_date = value;
      if (name === 'date_of_birth') next.dob = value;
      if (name === 'dob') next.date_of_birth = value;
      if (name === 'last_working_date') next.resignation_date = previous.resignation_date || value;
      if (name === 'resignation_date') next.last_working_date = previous.last_working_date || value;
      if (name === 'organisation_id') {
        const selected = entityOptions.find((option) => option.value === value);

        next.organisation_id = value;
        next.organization_id = value;
        next.organisation = selected?.name || '';
        next.organization = selected?.name || '';
        next.organisation_code = selected?.code || '';
        next.organization_code = selected?.code || '';
      }

      if (name === 'organisation_id') {
        const selected = entityOptions.find((option) => option.value === value);

        next.organisation_id = value;
        next.organization_id = value;
        next.organisation = selected?.name || '';
        next.organization = selected?.name || '';
        next.organisation_code = selected?.code || '';
        next.organization_code = selected?.code || '';
      }

      if (name === 'is_team_leader') next.is_team_leader = value === 'true';
      if (name === 'is_reporting_officer') next.is_reporting_officer = value === 'true';
      if (name === 'is_it_support_head') {
        next.is_it_support_head = checked;
        if (checked) next.is_it_support_member = true;
      }
      if (name === 'is_it_support_member') next.is_it_support_member = checked;

      if (name === 'team_leader_id' || name === 'reporting_officer_id') {
        return setSelectedEmployeeMapping(next, name, value);
      }

      return next;
    });
  };

  return (
    <form className="hrms-form-card" onSubmit={onSubmit}>
      <div className="hrms-section-heading">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
      </div>

      <FormSection title="Basic Employee Details">
        <TextInput label="Name" name="name" value={form.name} onChange={handleChange} required placeholder="Full name" />
        <TextInput label="Email" name="email" value={form.email} onChange={handleChange} type="email" required={!isAlumniForm} placeholder="employee@company.com" />
        <TextInput label="Avatar" name="profile_photo" value={form.profile_photo} onChange={handleChange} placeholder="/uploads/profile.jpg" />
        <TextInput label="Phone" name="phone" value={form.phone} onChange={handleChange} required placeholder="Phone number" />
        <SelectInput label="Country" name="country" value={form.country} onChange={handleChange} required options={[
          { value: '', label: 'Choose Country' },
          { value: 'India', label: 'India' },
          { value: 'Bangladesh', label: 'Bangladesh' },
        ]} />
        <TextInput label="Employee ID" name="employee_id" value={form.employee_id} onChange={handleChange} placeholder="EMP001" />
      </FormSection>

      <FormSection title="Job & Organization Details">
        <SelectInput label="Role" name="role" value={form.role} onChange={handleChange} options={ROLE_OPTIONS} required />
        <SelectInput
          label="Organisation / Entity"
          name="organisation_id"
          value={form.organisation_id}
          onChange={handleChange}
          options={entityOptions}
        />
        <SelectInput label="Designation" name="designation" value={form.designation} onChange={handleChange} options={designationOptions} required />
        <SelectInput label="Department" name="department" value={form.department} onChange={handleChange} options={departmentOptions} required />
        <TextInput label="Shift" name="shift" value={form.shift} onChange={handleChange} placeholder="General" required />
        <TextInput label="Branch" name="branch" value={form.branch} onChange={handleChange} placeholder="Assam/Guwahati (HO)" required />
        <SelectInput label="State" name="state" value={form.state} onChange={handleChange} options={stateOptions} required />
        <SelectInput label="Employee Type" name="employee_type" value={form.employee_type} onChange={handleChange} options={[{ value: '', label: 'Choose One' }, ...EMPLOYEE_TYPE_OPTIONS]} />
        <SelectInput label="Job Type" name="job_type" value={form.job_type} onChange={handleChange} options={JOB_TYPE_OPTIONS} />
        <SelectInput label="Employment Status" name="employment_status" value={form.employment_status} onChange={handleChange} options={[{ value: '', label: 'Choose One' }, ...STATUS_OPTIONS]} />
        <SelectInput label="Status" name="status" value={form.status} onChange={handleChange} options={STATUS_OPTIONS} />
      </FormSection>

      <FormSection title="Personal Details">
        <SelectInput
          label="Gender"
          name="gender"
          value={form.gender}
          onChange={handleChange}
          required
          options={[
            { value: '', label: 'Select Gender' },
            { value: 'Male', label: 'Male' },
            { value: 'Female', label: 'Female' },
            { value: 'Other', label: 'Other' },
          ]}
        />
        <TextInput label="Date Of Birth" name="date_of_birth" value={form.date_of_birth} onChange={handleChange} type="date" />
        <SelectInput label="Blood Group" name="blood_group" value={form.blood_group} onChange={handleChange} options={BLOOD_GROUP_OPTIONS} />
        <SelectInput label="Religion" name="religion" value={form.religion} onChange={handleChange} options={RELIGION_OPTIONS} />
        <SelectInput label="Marital Status" name="marital_status" value={form.marital_status} onChange={handleChange} options={MARITAL_STATUS_OPTIONS} />
        <TextInput label="Speak Language" name="speak_language" value={form.speak_language} onChange={handleChange} />
        <TextInput label="Father's Name" name="father_name" value={form.father_name} onChange={handleChange} />
        <TextInput label="Address" name="address" value={form.address} onChange={handleChange} />
      </FormSection>

      <FormSection title="Joining, Salary & Statutory Details">
        <TextInput label="Joining Date" name="joining_date" value={form.joining_date} onChange={handleChange} type="date" required />
        <TextInput label="Gross Salary" name="gross_salary" value={form.gross_salary} onChange={handleChange} type="number" required />
        <TextInput label="Salary" name="salary" value={form.salary} onChange={handleChange} type="number" />
        <SelectInput label="Payment Mode" name="payment_mode" value={form.payment_mode} onChange={handleChange} options={PAYMENT_MODE_OPTIONS} required />
        <TextInput label="PAN No" name="pan_no" value={form.pan_no} onChange={handleChange} />
        <TextInput label="Aadhar No" name="aadhar_no" value={form.aadhar_no} onChange={handleChange} />
        <TextInput label="Employee UAN No" name="employee_uan_no" value={form.employee_uan_no} onChange={handleChange} />
        <TextInput label="Employee ESIC IP" name="employee_esic_ip" value={form.employee_esic_ip} onChange={handleChange} />
      </FormSection>

      <FormSection title="Family, Disability & Skills">
        <SelectInput label="Skill Level" name="skill_level" value={form.skill_level} onChange={handleChange} options={SKILL_LEVEL_OPTIONS} />
        <SelectInput label="Disability Level" name="disability_level" value={form.disability_level} onChange={handleChange} options={DISABILITY_LEVEL_OPTIONS} required />
        <SelectInput label="Dependent Disability Level" name="dependent_disability_level" value={form.dependent_disability_level} onChange={handleChange} options={DISABILITY_LEVEL_OPTIONS} required />
        <SelectInput label="Are Parents Senior Citizen?" name="are_parents_senior_citizen" value={String(form.are_parents_senior_citizen || 'false')} onChange={handleChange} options={TRUE_FALSE_OPTIONS} required />
        <TextInput label="Number of Children" name="number_of_children" value={form.number_of_children} onChange={handleChange} type="number" />
        <TextInput label="No. of Children in Hostel" name="children_in_hostel" value={form.children_in_hostel} onChange={handleChange} />
      </FormSection>

      <FormSection title="Previous Employment Details">
        <TextInput label="Previous Employer Name" name="previous_employer_name" value={form.previous_employer_name} onChange={handleChange} />
        <TextInput label="Previous Designation" name="previous_designation" value={form.previous_designation} onChange={handleChange} />
        <TextInput label="Previous Employment Tenure From Date" name="previous_employment_tenure_from_date" value={form.previous_employment_tenure_from_date} onChange={handleChange} type="date" />
        <TextInput label="Previous Employment Tenure End Date" name="previous_employment_tenure_end_date" value={form.previous_employment_tenure_end_date} onChange={handleChange} type="date" />
      </FormSection>

      {!isAlumniForm ? (
        <>
          <FormSection title="Login & Reporting Mapping">
            <TextInput label="Password" name="password" value={form.password} onChange={handleChange} type="password" required={!isEdit} placeholder="Default Password (12345678)" />
            <SelectInput label="Is Team Leader?" name="is_team_leader" value={String(Boolean(form.is_team_leader))} onChange={handleChange} options={TRUE_FALSE_OPTIONS} />
            <SelectInput label="Is Reporting Officer?" name="is_reporting_officer" value={String(Boolean(form.is_reporting_officer))} onChange={handleChange} options={TRUE_FALSE_OPTIONS} />
            <SearchableEmployeeSelect
              label="Team Leader"
              name="team_leader_id"
              value={form.team_leader_id}
              searchValue={teamLeaderSearch}
              onSearchChange={setTeamLeaderSearch}
              onChange={handleChange}
              options={teamLeaders}
              placeholder="Search team leader by name, code, department..."
            />
            <SearchableEmployeeSelect
              label="Reporting Officer"
              name="reporting_officer_id"
              value={form.reporting_officer_id}
              searchValue={reportingOfficerSearch}
              onSearchChange={setReportingOfficerSearch}
              onChange={handleChange}
              options={reportingOfficers}
              placeholder="Search manager, director, managing director, CEO..."
            />
          </FormSection>

          <div className="hrms-checkbox-grid">
            <CheckboxInput label="IT Support Head" name="is_it_support_head" checked={form.is_it_support_head} onChange={handleChange} />
            <CheckboxInput label="IT Support Member" name="is_it_support_member" checked={form.is_it_support_member} onChange={handleChange} />
          </div>
        </>
      ) : (
        <FormSection title="Exit / Alumni Details">
          <TextInput label="Last Working Date" name="last_working_date" value={form.last_working_date} onChange={handleChange} type="date" required />
          <TextInput label="Resignation Date" name="resignation_date" value={form.resignation_date} onChange={handleChange} type="date" />
          <SelectInput label="Exit Type" name="exit_type" value={form.exit_type} onChange={handleChange} options={EXIT_TYPE_OPTIONS} />
          <TextInput label="Reason" name="resignation_reason" value={form.resignation_reason} onChange={handleChange} placeholder="Reason for leaving" />
        </FormSection>
      )}

      <div className="hrms-form-actions">
        <button className="hrms-primary-btn" type="submit" disabled={loading}>
          {loading ? 'Saving...' : submitLabel}
        </button>
        {isEdit ? <span className="hrms-form-note">Editing keeps the employee in the active master unless you mark resigned.</span> : null}
      </div>
    </form>
  );
}

function EmployeeMasterTable({ rows, loading, onEdit, onResign }) {
  if (loading) return <div className="hrms-empty-state">Loading employees...</div>;
  if (!rows.length) return <div className="hrms-empty-state">No active employees found.</div>;

  return (
    <div className="hrms-table-wrap">
      <table className="hrms-table">
        <thead>
          <tr>
            <th>Employee</th>
            <th>Code</th>
            <th>Organisation</th>
            <th>Department</th>
            <th>Designation</th>
            <th>Designation</th>
            <th>Contact</th>
            <th>Joining</th>
            <th>Status</th>
            <th className="hrms-table-action">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((employee) => {
            const id = employeeRowId(employee);

            return (
              <tr key={id || employee.email || employee.name}>
                <td>
                  <div className="hrms-person-cell">
                    <EmployeeAvatar employee={employee} />
                    <div>
                      <strong>{displayValue(employee.name || employee.employee_name)}</strong>
                      <small>{displayValue(employee.email || employee.official_email)}</small>
                    </div>
                  </div>
                </td>
                <td>
                  <strong>{displayValue(employee.emp_code || employee.employee_id)}</strong>
                  <small>{displayValue(employee.employee_id, '')}</small>
                </td>
                <td>
                  <strong>{displayValue(employee.organisation_code || employee.organization_code)}</strong>
                  <small>{displayValue(employee.organisation || employee.organization, '')}</small>
                </td>
                <td>{displayValue(employee.department)}</td>
                <td>{displayValue(employee.designation)}</td>
                <td>
                  <strong>{displayValue(employee.phone || employee.mobile)}</strong>
                  <small>{displayValue(employee.branch, '')}</small>
                </td>
                <td>{displayDate(employee.joining_date || employee.date_of_joining)}</td>
                <td>
                  <span className="hrms-pill hrms-pill-green">
                    {displayValue(employee.employment_status || employee.status, 'Active')}
                  </span>
                </td>
                <td className="hrms-table-action">
                  <div className="hrms-row-actions">
                    <button type="button" className="hrms-secondary-btn compact" onClick={() => onEdit(employee)} disabled={!id}>
                      Edit
                    </button>
                    <button type="button" className="hrms-danger-soft-btn compact" onClick={() => onResign(employee)} disabled={!id}>
                      Mark Resigned
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AlumniTable({ rows, loading }) {
  if (loading) return <div className="hrms-empty-state">Loading alumni employees...</div>;
  if (!rows.length) return <div className="hrms-empty-state">No alumni employees found.</div>;

  return (
    <div className="hrms-table-wrap">
      <table className="hrms-table">
        <thead>
          <tr>
            <th>Employee</th>
            <th>Code</th>
            <th>Department</th>
            <th>Designation</th>
            <th>Exit Type</th>
            <th>Last Working Date</th>
            <th>Reason</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((employee) => (
            <tr key={employeeRowId(employee) || employee.email || employee.name}>
              <td>
                <div className="hrms-person-cell">
                  <EmployeeAvatar employee={employee} />
                  <div>
                    <strong>{displayValue(employee.name || employee.employee_name)}</strong>
                    <small>{displayValue(employee.email || employee.official_email)}</small>
                  </div>
                </div>
              </td>
              <td>
                <strong>{displayValue(employee.emp_code || employee.employee_id)}</strong>
                <small>{displayValue(employee.employee_id, '')}</small>
              </td>
              <td>{displayValue(employee.department)}</td>
              <td>{displayValue(employee.designation)}</td>
              <td>{displayValue(employee.exit_type)}</td>
              <td>{displayDate(employee.last_working_date || employee.resignation_date)}</td>
              <td>{displayValue(employee.resignation_reason)}</td>
              <td>
                <span className="hrms-pill hrms-pill-red">
                  {displayValue(employee.employment_status || employee.status, 'Resigned')}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Employees() {
  const [activeTab, setActiveTab] = useState('master');
  const [employees, setEmployees] = useState([]);
  const [alumni, setAlumni] = useState([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [loadingAlumni, setLoadingAlumni] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  const [organisations, setOrganisations] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [states, setStates] = useState([]);
  const [teamLeaders, setTeamLeaders] = useState([]);
  const [reportingOfficers, setReportingOfficers] = useState([]);
  const [teamLeaderSearch, setTeamLeaderSearch] = useState('');
  const [reportingOfficerSearch, setReportingOfficerSearch] = useState('');
  const [editTeamLeaderSearch, setEditTeamLeaderSearch] = useState('');
  const [editReportingOfficerSearch, setEditReportingOfficerSearch] = useState('');

  const [employeeForm, setEmployeeForm] = useState(EMPTY_EMPLOYEE_FORM);
  const [alumniForm, setAlumniForm] = useState(EMPTY_ALUMNI_FORM);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_EMPLOYEE_FORM);

  const [filters, setFilters] = useState({ q: '', department: '', designation: '', branch: '', employment_status: '' });
  const [alumniFilters, setAlumniFilters] = useState({ q: '', department: '', designation: '', branch: '', employment_status: '' });
  const [resignEmployee, setResignEmployee] = useState(null);
  const [resignForm, setResignForm] = useState(EMPTY_RESIGN_FORM);

  const employeeDepartments = useMemo(() => uniqueOptions(employees, 'department'), [employees]);
  const employeeDesignations = useMemo(() => uniqueOptions(employees, 'designation'), [employees]);
  const employeeBranches = useMemo(() => uniqueOptions(employees, 'branch'), [employees]);
  const alumniDepartments = useMemo(() => uniqueOptions(alumni, 'department'), [alumni]);
  const alumniDesignations = useMemo(() => uniqueOptions(alumni, 'designation'), [alumni]);
  const alumniBranches = useMemo(() => uniqueOptions(alumni, 'branch'), [alumni]);

  const filteredEmployees = useMemo(() => filterEmployees(employees, filters), [employees, filters]);
  const filteredAlumni = useMemo(() => filterEmployees(alumni, alumniFilters), [alumni, alumniFilters]);

  const employeeStats = useMemo(() => ({
    active: employees.length,
    departments: uniqueOptions(employees, 'department').length,
    designations: uniqueOptions(employees, 'designation').length,
    alumni: alumni.length,
  }), [employees, alumni]);

  const showMessage = (type, text) => {
    setMessage({ type, text });
    window.clearTimeout(window.__employeeMessageTimer);
    window.__employeeMessageTimer = window.setTimeout(() => setMessage({ type: '', text: '' }), 4000);
  };

  const loadFormOptions = async () => {
    try {
      const [masterData, organisationData, teamLeaderData, reportingOfficerData] = await Promise.all([
        getEmployeeFormOptions(),
        getActiveOrganisations({ limit: 500 }),
        getTeamLeaderOptions({ limit: 500 }),
        getReportingOfficerOptions({ limit: 500 }),
      ]);

      setOrganisations(organisationData.items || []);
      setDepartments(masterData.departments || []);
      setDesignations(masterData.designations || []);
      setStates(masterData.states || []);
      setTeamLeaders(teamLeaderData.items || []);
      setReportingOfficers(reportingOfficerData.items || []);
    } catch (error) {
      showMessage('error', error.message || 'Unable to load employee form dropdowns.');
    }
  };

  const loadEmployees = async () => {
    setLoadingEmployees(true);
    try {
      const data = await getActiveEmployees({ limit: 500, sort_by: 'created_at', sort_dir: 'desc' });
      setEmployees(data.items || []);
    } catch (error) {
      showMessage('error', error.message || 'Unable to load employees.');
    } finally {
      setLoadingEmployees(false);
    }
  };

  const loadAlumni = async () => {
    setLoadingAlumni(true);
    try {
      const data = await getAlumniEmployees({ limit: 500, sort_by: 'last_working_date', sort_dir: 'desc' });
      setAlumni(data.items || []);
    } catch (error) {
      showMessage('error', error.message || 'Unable to load alumni employees.');
    } finally {
      setLoadingAlumni(false);
    }
  };

  const reloadAll = async () => {
    await Promise.all([loadFormOptions(), loadEmployees(), loadAlumni()]);
  };

  useEffect(() => {
    reloadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFilterChange = (event) => setFilters((previous) => ({ ...previous, [event.target.name]: event.target.value }));
  const handleAlumniFilterChange = (event) => setAlumniFilters((previous) => ({ ...previous, [event.target.name]: event.target.value }));
  const resetFilters = () => setFilters({ q: '', department: '', designation: '', branch: '', employment_status: '' });
  const resetAlumniFilters = () => setAlumniFilters({ q: '', department: '', designation: '', branch: '', employment_status: '' });

  const handleCreateEmployee = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await createEmployee(employeePayloadFromForm(employeeForm, { status: 'active', employment_status: 'active', is_alumni: false }));
      setEmployeeForm(EMPTY_EMPLOYEE_FORM);
      setTeamLeaderSearch('');
      setReportingOfficerSearch('');
      await loadEmployees();
      setActiveTab('master');
      showMessage('success', 'Employee created successfully.');
    } catch (error) {
      showMessage('error', error.message || 'Unable to create employee.');
    } finally {
      setSaving(false);
    }
  };

  const handleCreatePastEmployee = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await createPastEmployee(employeePayloadFromForm(alumniForm, {
        is_alumni: true,
        skip_login: true,
        status: 'Resigned',
        employment_status: 'Resigned',
      }));
      setAlumniForm(EMPTY_ALUMNI_FORM);
      await loadAlumni();
      showMessage('success', 'Past employee added to alumni successfully.');
    } catch (error) {
      showMessage('error', error.message || 'Unable to add past employee.');
    } finally {
      setSaving(false);
    }
  };

  const openEditModal = (employee) => {
    const normalized = normalizeEmployeeForForm(employee);

    setEditingEmployee(employee);
    setEditForm(normalized);
    setEditTeamLeaderSearch(normalized.team_leader_name || '');
    setEditReportingOfficerSearch(normalized.reporting_officer_name || '');
  };

  const closeEditModal = () => {
    setEditingEmployee(null);
    setEditForm(EMPTY_EMPLOYEE_FORM);
    setEditTeamLeaderSearch('');
    setEditReportingOfficerSearch('');
  };

  const handleUpdateEmployee = async (event) => {
    event.preventDefault();

    const id = employeeRowId(editingEmployee || {});
    if (!id) {
      showMessage('error', 'Employee ID not found.');
      return;
    }

    setSaving(true);
    try {
      await updateEmployee(id, employeePayloadFromForm(editForm));
      closeEditModal();
      await reloadAll();
      showMessage('success', 'Employee updated successfully.');
    } catch (error) {
      showMessage('error', error.message || 'Unable to update employee.');
    } finally {
      setSaving(false);
    }
  };

  const openResignModal = (employee) => {
    setResignEmployee(employee);
    const today = new Date().toISOString().slice(0, 10);
    setResignForm({ ...EMPTY_RESIGN_FORM, last_working_date: today, resignation_date: today });
  };

  const closeResignModal = () => {
    setResignEmployee(null);
    setResignForm(EMPTY_RESIGN_FORM);
  };

  const handleResignChange = (event) => {
    const { name, value } = event.target;
    setResignForm((previous) => {
      const next = { ...previous, [name]: value };
      if (name === 'last_working_date') next.resignation_date = previous.resignation_date || value;
      if (name === 'resignation_date') next.last_working_date = previous.last_working_date || value;
      return next;
    });
  };

  const handleConfirmResignation = async (event) => {
    event.preventDefault();
    if (!resignEmployee) return;

    const id = employeeRowId(resignEmployee);
    if (!id) {
      showMessage('error', 'Employee ID not found.');
      return;
    }

    setSaving(true);
    try {
      await markEmployeeAsResigned(id, {
        ...resignForm,
        status: 'Resigned',
        employment_status: 'Resigned',
      });
      closeResignModal();
      await reloadAll();
      showMessage('success', 'Employee moved to alumni successfully.');
    } catch (error) {
      showMessage('error', error.message || 'Unable to mark employee as resigned.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="hrms-employees-page">
      <style>{`
        .hrms-employees-page{display:flex;flex-direction:column;gap:18px;color:#172033}.hrms-hero{border-radius:28px;padding:24px;background:radial-gradient(circle at top left,rgba(37,99,235,.18),transparent 34%),linear-gradient(135deg,#0f172a 0%,#1e293b 54%,#2563eb 100%);color:#fff;box-shadow:0 22px 50px rgba(15,23,42,.18);overflow:hidden;position:relative}.hrms-hero::after{content:"";position:absolute;width:220px;height:220px;border-radius:999px;right:-70px;top:-70px;background:rgba(255,255,255,.12)}.hrms-hero-content{position:relative;z-index:1;display:flex;justify-content:space-between;gap:20px;align-items:flex-start}.hrms-kicker{display:inline-flex;align-items:center;gap:8px;padding:7px 12px;border-radius:999px;background:rgba(255,255,255,.14);color:#dbeafe;font-weight:800;font-size:12px;letter-spacing:.08em;text-transform:uppercase}.hrms-hero h1{margin:14px 0 8px;font-size:clamp(28px,4vw,42px);line-height:1.05}.hrms-hero p{max-width:780px;margin:0;color:rgba(255,255,255,.78);line-height:1.7}.hrms-refresh-btn,.hrms-primary-btn,.hrms-secondary-btn,.hrms-danger-soft-btn,.hrms-tab-btn{border:0;cursor:pointer;font-weight:800;transition:transform .18s ease,box-shadow .18s ease,background .18s ease}.hrms-refresh-btn:hover,.hrms-primary-btn:hover,.hrms-secondary-btn:hover,.hrms-danger-soft-btn:hover,.hrms-tab-btn:hover{transform:translateY(-1px)}.hrms-refresh-btn{position:relative;z-index:1;border-radius:16px;padding:11px 15px;background:rgba(255,255,255,.16);color:#fff;border:1px solid rgba(255,255,255,.22)}.hrms-stats-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.hrms-stat-card{background:#fff;border:1px solid #e7edf7;border-radius:22px;padding:18px;box-shadow:0 14px 35px rgba(15,23,42,.07)}.hrms-stat-card span{display:block;color:#64748b;font-size:13px;font-weight:800;margin-bottom:8px}.hrms-stat-card strong{font-size:30px;color:#0f172a}.hrms-tabs{display:flex;flex-wrap:wrap;gap:10px;background:#fff;border:1px solid #e7edf7;border-radius:22px;padding:10px;box-shadow:0 12px 32px rgba(15,23,42,.06)}.hrms-tab-btn{padding:12px 16px;border-radius:16px;color:#475569;background:#f8fafc}.hrms-tab-btn.active{background:#2563eb;color:#fff;box-shadow:0 12px 24px rgba(37,99,235,.25)}.hrms-alert{border-radius:18px;padding:13px 16px;font-weight:800;animation:hrmsSlideDown .24s ease both}.hrms-alert.success{color:#166534;background:#dcfce7;border:1px solid #bbf7d0}.hrms-alert.error{color:#991b1b;background:#fee2e2;border:1px solid #fecaca}@keyframes hrmsSlideDown{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}.hrms-panel,.hrms-form-card{background:#fff;border:1px solid #e7edf7;border-radius:26px;padding:18px;box-shadow:0 18px 45px rgba(15,23,42,.08)}.hrms-section-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:16px}.hrms-section-heading h3{margin:0 0 5px;color:#0f172a;font-size:21px}.hrms-section-heading p{margin:0;color:#64748b;line-height:1.55}.hrms-actions,.hrms-row-actions{display:flex;flex-wrap:wrap;gap:10px}.hrms-filter-grid{display:grid;grid-template-columns:1.7fr repeat(4,minmax(130px,1fr)) auto;gap:10px;margin-bottom:16px}.hrms-filter-grid input,.hrms-filter-grid select,.hrms-field input,.hrms-field select{width:100%;border:1px solid #dbe4f0;background:#f8fafc;color:#172033;border-radius:15px;padding:12px 13px;outline:none;font:inherit;transition:border .18s ease,box-shadow .18s ease,background .18s ease}.hrms-filter-grid input:focus,.hrms-filter-grid select:focus,.hrms-field input:focus,.hrms-field select:focus{border-color:#2563eb;box-shadow:0 0 0 4px rgba(37,99,235,.12);background:#fff}.hrms-primary-btn{border-radius:15px;padding:12px 16px;background:#2563eb;color:#fff;box-shadow:0 12px 24px rgba(37,99,235,.22)}.hrms-primary-btn:disabled{opacity:.65;cursor:not-allowed}.hrms-secondary-btn{border-radius:15px;padding:12px 16px;background:#eef4ff;color:#1d4ed8}.hrms-danger-soft-btn{border-radius:14px;padding:10px 12px;background:#fff1f2;color:#be123c}.compact{padding:8px 10px!important;font-size:12px}.hrms-table-wrap{width:100%;overflow-x:auto;border:1px solid #e7edf7;border-radius:20px}.hrms-table{width:100%;min-width:1050px;border-collapse:collapse;background:#fff}.hrms-table th{text-align:left;background:#f8fafc;color:#475569;font-size:12px;letter-spacing:.04em;text-transform:uppercase;padding:14px;border-bottom:1px solid #e7edf7}.hrms-table td{padding:14px;border-bottom:1px solid #edf2f7;vertical-align:middle;color:#334155}.hrms-table tr:last-child td{border-bottom:0}.hrms-person-cell{display:flex;align-items:center;gap:12px;min-width:230px}.hrms-person-cell strong,.hrms-table td strong{display:block;color:#0f172a;font-weight:900}.hrms-person-cell small,.hrms-table td small{display:block;color:#64748b;margin-top:4px;font-size:12px}.hrms-employee-avatar{width:42px;height:42px;border-radius:16px;display:inline-flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;font-weight:900;object-fit:cover;flex:0 0 auto}.hrms-pill{display:inline-flex;align-items:center;border-radius:999px;padding:7px 10px;font-size:12px;font-weight:900}.hrms-pill-green{background:#dcfce7;color:#166534}.hrms-pill-red{background:#ffe4e6;color:#be123c}.hrms-table-action{text-align:right!important;white-space:nowrap}.hrms-empty-state{border:1px dashed #cbd5e1;background:#f8fafc;color:#64748b;padding:28px;text-align:center;border-radius:20px;font-weight:800}.hrms-form-section{border:1px solid #edf2f7;border-radius:20px;padding:14px;margin-top:14px;background:#fbfdff}.hrms-form-section:first-of-type{margin-top:0}.hrms-form-section h4{margin:0 0 12px;color:#0f172a;font-size:15px}.hrms-form-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.hrms-field{display:flex;flex-direction:column;gap:7px}.hrms-field span{color:#334155;font-weight:900;font-size:13px}.hrms-field b{color:#dc2626;margin-left:3px}.hrms-searchable-field input{margin-bottom:8px}.hrms-searchable-field select{background:#fff}.hrms-checkbox-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:16px}.hrms-checkbox{display:flex;gap:10px;align-items:center;border:1px solid #e7edf7;border-radius:16px;padding:12px;background:#f8fafc;font-weight:800;color:#334155}.hrms-checkbox input{width:18px;height:18px}.hrms-form-actions{margin-top:18px;display:flex;justify-content:flex-end;align-items:center;gap:12px;flex-wrap:wrap}.hrms-form-note{color:#64748b;font-weight:700;font-size:13px}.hrms-alumni-layout{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(360px,.9fr);gap:18px}.hrms-modal-backdrop{position:fixed;inset:0;z-index:60;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:20px}.hrms-modal{width:min(1120px,100%);max-height:92vh;overflow:auto;background:#fff;border-radius:26px;padding:20px;box-shadow:0 30px 80px rgba(15,23,42,.28);animation:hrmsModalIn .22s ease both}.hrms-modal.small{width:min(560px,100%)}@keyframes hrmsModalIn{from{opacity:0;transform:scale(.96) translateY(8px)}to{opacity:1;transform:scale(1) translateY(0)}}.hrms-modal h3{margin:0 0 6px;color:#0f172a}.hrms-modal p{margin:0 0 16px;color:#64748b}.hrms-modal-grid{display:grid;gap:12px}.hrms-modal-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}@media(max-width:1100px){.hrms-filter-grid,.hrms-form-grid,.hrms-alumni-layout{grid-template-columns:1fr 1fr}.hrms-checkbox-grid,.hrms-stats-grid{grid-template-columns:1fr 1fr}}@media(max-width:720px){.hrms-hero-content,.hrms-section-heading{flex-direction:column}.hrms-filter-grid,.hrms-form-grid,.hrms-alumni-layout,.hrms-checkbox-grid,.hrms-stats-grid{grid-template-columns:1fr}.hrms-actions,.hrms-form-actions,.hrms-modal-actions{justify-content:stretch}.hrms-actions button,.hrms-form-actions button,.hrms-modal-actions button,.hrms-refresh-btn{width:100%}.hrms-hero{padding:20px;border-radius:22px}.hrms-row-actions{justify-content:flex-end}}
      `}</style>

      <div className="hrms-hero">
        <div className="hrms-hero-content">
          <div>
            <span className="hrms-kicker">HR Employee Management</span>
            <h1>Employee Master, Create Employee & Alumni</h1>
            <p>
              Manage active employees separately from past employees. Create employees with the full employee form,
              edit existing employees, mark resigned employees and maintain alumni records.
            </p>
          </div>
          <button type="button" className="hrms-refresh-btn" onClick={reloadAll}>Refresh Data</button>
        </div>
      </div>

      <div className="hrms-stats-grid">
        <div className="hrms-stat-card"><span>Active Employees</span><strong>{employeeStats.active}</strong></div>
        <div className="hrms-stat-card"><span>Departments</span><strong>{employeeStats.departments}</strong></div>
        <div className="hrms-stat-card"><span>Designations</span><strong>{employeeStats.designations}</strong></div>
        <div className="hrms-stat-card"><span>Alumni</span><strong>{employeeStats.alumni}</strong></div>
      </div>

      <div className="hrms-tabs">
        <button type="button" className={`hrms-tab-btn ${activeTab === 'master' ? 'active' : ''}`} onClick={() => setActiveTab('master')}>Employee Master</button>
        <button type="button" className={`hrms-tab-btn ${activeTab === 'create' ? 'active' : ''}`} onClick={() => setActiveTab('create')}>Create Employee</button>
        <button type="button" className={`hrms-tab-btn ${activeTab === 'alumni' ? 'active' : ''}`} onClick={() => setActiveTab('alumni')}>Alumni</button>
      </div>

      {message.text ? <div className={`hrms-alert ${message.type}`}>{message.text}</div> : null}

      {activeTab === 'master' ? (
        <div className="hrms-panel">
          <div className="hrms-section-heading">
            <div>
              <h3>Employee Master</h3>
              <p>Showing only active/current employees. Use Edit to update existing employee details.</p>
            </div>
            <div className="hrms-actions">
              <button type="button" className="hrms-secondary-btn" onClick={() => downloadEmployeeCsv(filteredEmployees)}>Download Active CSV</button>
              <button type="button" className="hrms-primary-btn" onClick={() => setActiveTab('create')}>Create Employee</button>
            </div>
          </div>

          <div className="hrms-filter-grid">
            <input name="q" value={filters.q} onChange={handleFilterChange} placeholder="Search by name, email, department, designation, phone..." />
            <select name="department" value={filters.department} onChange={handleFilterChange}>
              <option value="">All Departments</option>
              {employeeDepartments.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <select name="designation" value={filters.designation} onChange={handleFilterChange}>
              <option value="">All Designations</option>
              {employeeDesignations.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <select name="branch" value={filters.branch} onChange={handleFilterChange}>
              <option value="">All Branches</option>
              {employeeBranches.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <select name="employment_status" value={filters.employment_status} onChange={handleFilterChange}>
              <option value="">All Status</option>
              <option value="active">Active</option>
              <option value="probation">Probation</option>
              <option value="confirmed">Confirmed</option>
            </select>
            <button type="button" className="hrms-secondary-btn" onClick={resetFilters}>Reset</button>
          </div>

          <EmployeeMasterTable rows={filteredEmployees} loading={loadingEmployees} onEdit={openEditModal} onResign={openResignModal} />
        </div>
      ) : null}

      {activeTab === 'create' ? (
        <EmployeeForm
          title="Create Employee"
          subtitle="Create a new active employee using the full employee form. Login user will be created automatically by the backend."
          form={employeeForm}
          setForm={setEmployeeForm}
          onSubmit={handleCreateEmployee}
          submitLabel="Create Employee"
          loading={saving}
          organisations={organisations}
          departments={departments}
          designations={designations}
          states={states}
          teamLeaders={teamLeaders}
          reportingOfficers={reportingOfficers}
          teamLeaderSearch={teamLeaderSearch}
          setTeamLeaderSearch={setTeamLeaderSearch}
          reportingOfficerSearch={reportingOfficerSearch}
          setReportingOfficerSearch={setReportingOfficerSearch}
        />
      ) : null}

      {activeTab === 'alumni' ? (
        <div className="hrms-alumni-layout">
          <div className="hrms-panel">
            <div className="hrms-section-heading">
              <div>
                <h3>Alumni Employees</h3>
                <p>Employees who resigned, left, retired, or were manually added as past employees are listed here.</p>
              </div>
              <div className="hrms-actions">
                <button type="button" className="hrms-secondary-btn" onClick={() => downloadAlumniCsv(filteredAlumni)}>Download Alumni CSV</button>
              </div>
            </div>

            <div className="hrms-filter-grid">
              <input name="q" value={alumniFilters.q} onChange={handleAlumniFilterChange} placeholder="Search alumni by name, department, reason, status..." />
              <select name="department" value={alumniFilters.department} onChange={handleAlumniFilterChange}>
                <option value="">All Departments</option>
                {alumniDepartments.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <select name="designation" value={alumniFilters.designation} onChange={handleAlumniFilterChange}>
                <option value="">All Designations</option>
                {alumniDesignations.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <select name="branch" value={alumniFilters.branch} onChange={handleAlumniFilterChange}>
                <option value="">All Branches</option>
                {alumniBranches.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <select name="employment_status" value={alumniFilters.employment_status} onChange={handleAlumniFilterChange}>
                <option value="">All Status</option>
                <option value="Resigned">Resigned</option>
                <option value="Terminated">Terminated</option>
                <option value="Retired">Retired</option>
                <option value="Left">Left</option>
              </select>
              <button type="button" className="hrms-secondary-btn" onClick={resetAlumniFilters}>Reset</button>
            </div>
            <AlumniTable rows={filteredAlumni} loading={loadingAlumni} />
          </div>

          <EmployeeForm
            title="Add Past Employee"
            subtitle="Add employees who already left the company. No login account will be created."
            form={alumniForm}
            setForm={setAlumniForm}
            onSubmit={handleCreatePastEmployee}
            submitLabel="Add To Alumni"
            loading={saving}
            isAlumniForm
            organisations={organisations}
            departments={departments}
            designations={designations}
            states={states}
            teamLeaders={teamLeaders}
            reportingOfficers={reportingOfficers}
            teamLeaderSearch={teamLeaderSearch}
            setTeamLeaderSearch={setTeamLeaderSearch}
            reportingOfficerSearch={reportingOfficerSearch}
            setReportingOfficerSearch={setReportingOfficerSearch}
          />
        </div>
      ) : null}

      {editingEmployee ? (
        <div className="hrms-modal-backdrop">
          <div className="hrms-modal">
            <EmployeeForm
              title="Edit Employee"
              subtitle={`Update details for ${editingEmployee.name || editingEmployee.employee_name || 'employee'}.`}
              form={editForm}
              setForm={setEditForm}
              onSubmit={handleUpdateEmployee}
              submitLabel="Update Employee"
              loading={saving}
              isEdit
              organisations={organisations}
              departments={departments}
              designations={designations}
              states={states}
              teamLeaders={teamLeaders}
              reportingOfficers={reportingOfficers}
              teamLeaderSearch={editTeamLeaderSearch}
              setTeamLeaderSearch={setEditTeamLeaderSearch}
              reportingOfficerSearch={editReportingOfficerSearch}
              setReportingOfficerSearch={setEditReportingOfficerSearch}
            />
            <div className="hrms-modal-actions">
              <button type="button" className="hrms-secondary-btn" onClick={closeEditModal}>Close</button>
            </div>
          </div>
        </div>
      ) : null}

      {resignEmployee ? (
        <div className="hrms-modal-backdrop">
          <form className="hrms-modal small" onSubmit={handleConfirmResignation}>
            <h3>Mark Employee as Resigned</h3>
            <p>
              This will move <strong>{resignEmployee.name || resignEmployee.employee_name}</strong> from Employee Master to Alumni and deactivate the employee login.
            </p>
            <div className="hrms-modal-grid">
              <TextInput label="Last Working Date" name="last_working_date" value={resignForm.last_working_date} onChange={handleResignChange} type="date" required />
              <SelectInput label="Exit Type" name="exit_type" value={resignForm.exit_type} onChange={handleResignChange} options={EXIT_TYPE_OPTIONS} />
              <TextInput label="Reason" name="resignation_reason" value={resignForm.resignation_reason} onChange={handleResignChange} placeholder="Reason for resignation" />
            </div>
            <div className="hrms-modal-actions">
              <button type="button" className="hrms-secondary-btn" onClick={closeResignModal}>Cancel</button>
              <button type="submit" className="hrms-primary-btn" disabled={saving}>{saving ? 'Updating...' : 'Confirm Resignation'}</button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
