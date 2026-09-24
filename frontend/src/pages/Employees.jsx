import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Archive,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  History,
  Loader2,
  PlusCircle,
  RefreshCw,
  Search,
  Sparkles,
  UserPlus,
  Users,
  XCircle,
} from 'lucide-react';

import {
  createEmployee,
  createPastEmployee,
  downloadAlumniCsv,
  downloadEmployeeMasterExcel,
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

const EMPLOYEE_NOTICE_HIDE_MS = 3600;
const EMPLOYEE_PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

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

function uniqueStateOptions(rows = []) {
  return Array.from(
    new Set(
      rows
        .map((row) => String(row?.state || row?.branch || '').trim())
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

  // State is authoritative. Keep legacy Branch readable for existing records only.
  merged.state =
    merged.state ||
    merged.office_state ||
    merged.work_state ||
    merged.current_state ||
    merged.branch ||
    '';

  // Never expose legacy Branch or password fields through this form.
  delete merged.branch;
  delete merged.password;
  delete merged.password_mode;

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

  payload.state =
    payload.state ||
    payload.office_state ||
    payload.work_state ||
    payload.current_state ||
    payload.branch ||
    '';

  // State is authoritative. Branch is accepted only as legacy input.
  delete payload.branch;

  // Employee profile create/update requests must never control passwords.
  // The backend assigns 12345678 only when a new employee is created.
  delete payload.password;
  delete payload.password_mode;

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


function pageCountFor(rows = [], pageSize = 10) {
  if (pageSize === 'all') return 1;

  return Math.max(
    1,
    Math.ceil((rows?.length || 0) / Number(pageSize || 10)),
  );
}

function paginateRows(rows = [], page = 1, pageSize = 10) {
  if (pageSize === 'all') return rows;

  const size = Number(pageSize || 10);
  const safePage = Math.max(1, Number(page || 1));
  const start = (safePage - 1) * size;

  return rows.slice(start, start + size);
}

function pageNumbers(pageCount, page) {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const current = Math.max(1, Math.min(pageCount, page));
  const pages = new Set([1, pageCount, current]);

  if (current > 2) pages.add(current - 1);
  if (current < pageCount - 1) pages.add(current + 1);

  const sorted = Array.from(pages).sort((a, b) => a - b);
  const output = [];

  sorted.forEach((value, index) => {
    const previous = sorted[index - 1];

    if (index > 0 && value - previous > 1) {
      output.push(`ellipsis-${previous}-${value}`);
    }

    output.push(value);
  });

  return output;
}

function EmployeeInlineMessage({ message, onClose }) {
  if (!message?.text) return null;

  return (
    <div
      className={`hrms-inline-feedback ${message.type || 'info'}`}
      role="status"
    >
      <span className="hrms-inline-feedback-icon">
        {message.loading ? (
          <Loader2 size={15} className="hrms-spin" />
        ) : message.type === 'success' ? (
          <CheckCircle2 size={15} />
        ) : message.type === 'error' || message.type === 'warning' ? (
          <XCircle size={15} />
        ) : (
          <Sparkles size={15} />
        )}
      </span>

      <span className="hrms-inline-feedback-copy">
        {message.title ? <strong>{message.title}</strong> : null}
        <span>{message.text}</span>
      </span>

      <button
        type="button"
        className="hrms-inline-feedback-close"
        onClick={onClose}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
}

function EmployeePagination({
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  label = 'records',
}) {
  const pageCount =
    pageSize === 'all'
      ? 1
      : Math.max(
          1,
          Math.ceil(Number(total || 0) / Number(pageSize || 10)),
        );

  if (!total) return null;

  const safePage = Math.min(Math.max(1, page), pageCount);

  return (
    <div className="hrms-pagination">
      <div className="hrms-pagination-copy">
        <strong>{Number(total || 0).toLocaleString('en-IN')}</strong>
        <span>{label}</span>
      </div>

      <div className="hrms-pagination-controls">
        <label className="hrms-page-size-control">
          <span>View</span>
          <select
            value={pageSize}
            onChange={(event) =>
              onPageSizeChange(
                event.target.value === 'all'
                  ? 'all'
                  : Number(event.target.value),
              )
            }
            aria-label={`Number of ${label} to show`}
          >
            <option value="all">View All</option>
            {EMPLOYEE_PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="hrms-page-button"
          onClick={() => onPageChange(Math.max(1, safePage - 1))}
          disabled={safePage <= 1 || pageSize === 'all'}
          aria-label="Previous page"
        >
          <ChevronLeft size={14} />
          <span>Previous</span>
        </button>

        <div className="hrms-page-numbers" aria-label="Pagination">
          {pageNumbers(pageCount, safePage).map((item) =>
            typeof item === 'number' ? (
              <button
                type="button"
                key={item}
                className={`hrms-page-number ${
                  item === safePage ? 'active' : ''
                }`}
                onClick={() => onPageChange(item)}
                disabled={pageSize === 'all'}
                aria-current={item === safePage ? 'page' : undefined}
              >
                {item}
              </button>
            ) : (
              <span key={item} className="hrms-page-ellipsis">
                …
              </span>
            ),
          )}
        </div>

        <span className="hrms-page-indicator">
          Page {safePage} of {pageCount}
        </span>

        <button
          type="button"
          className="hrms-page-button"
          onClick={() =>
            onPageChange(Math.min(pageCount, safePage + 1))
          }
          disabled={safePage >= pageCount || pageSize === 'all'}
          aria-label="Next page"
        >
          <span>Next</span>
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
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
  feedback = null,
  onFeedbackClose = () => {},
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
              placeholder="Search any active Team Leader by name, code, department, organization..."
            />
            <SearchableEmployeeSelect
              label="Reporting Officer"
              name="reporting_officer_id"
              value={form.reporting_officer_id}
              searchValue={reportingOfficerSearch}
              onSearchChange={setReportingOfficerSearch}
              onChange={handleChange}
              options={reportingOfficers}
              placeholder="Search any active Reporting Officer / Manager / Director / CEO..."
            />
            <div className="hrms-form-note" style={{ gridColumn: '1 / -1' }}>
              New employees receive the default login password <strong>12345678</strong> from the system only at first creation. Editing employee details never changes an existing password. Team Leader and Reporting Officer mapping remains employee-based.
            </div>
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
        {feedback?.text ? (
          <EmployeeInlineMessage
            message={feedback}
            onClose={onFeedbackClose}
          />
        ) : null}
      </div>
    </form>
  );
}

function handleTableMouseDragStart(event) {
  if (event.button !== 0) return;
  if (event.target.closest('button, a, input, select, textarea, label')) return;

  const wrapper = event.currentTarget;
  const startX = event.clientX;
  const startScrollLeft = wrapper.scrollLeft;

  wrapper.classList.add('is-dragging');
  event.preventDefault();

  const handleMouseMove = (moveEvent) => {
    const deltaX = moveEvent.clientX - startX;
    wrapper.scrollLeft = startScrollLeft - deltaX;
  };

  const handleMouseUp = () => {
    wrapper.classList.remove('is-dragging');
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  };

  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('mouseup', handleMouseUp);
}

function EmployeeMasterTable({ rows, loading, onEdit, onResign }) {
  if (loading) return <div className="hrms-empty-state">Loading employees...</div>;
  if (!rows.length) return <div className="hrms-empty-state">No active employees found.</div>;

  return (
    <div className="hrms-table-wrap" onMouseDown={handleTableMouseDragStart}>
      <table className="hrms-table">
        <thead>
          <tr>
            <th>Employee</th>
            <th>Code</th>
            <th>Organisation</th>
            <th>Department</th>
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
                <td data-label="Employee">
                  <div className="hrms-person-cell">
                    <EmployeeAvatar employee={employee} />
                    <div>
                      <strong>{displayValue(employee.name || employee.employee_name)}</strong>
                      <small>{displayValue(employee.email || employee.official_email)}</small>
                    </div>
                  </div>
                </td>
                <td data-label="Code">
                  <strong>{displayValue(employee.emp_code || employee.employee_id)}</strong>
                  <small>{displayValue(employee.employee_id, '')}</small>
                </td>
                <td data-label="Organisation">
                  <strong>{displayValue(employee.organisation_code || employee.organization_code)}</strong>
                  <small>{displayValue(employee.organisation || employee.organization, '')}</small>
                </td>
                <td data-label="Department">{displayValue(employee.department)}</td>
                <td data-label="Designation">{displayValue(employee.designation)}</td>
                <td data-label="Contact">
                  <strong>{displayValue(employee.phone || employee.mobile)}</strong>
                  <small>{displayValue(employee.state || employee.branch, '')}</small>
                </td>
                <td data-label="Joining">{displayDate(employee.joining_date || employee.date_of_joining)}</td>
                <td data-label="Status">
                  <span className="hrms-pill hrms-pill-green">
                    {displayValue(employee.employment_status || employee.status, 'Active')}
                  </span>
                </td>
                <td className="hrms-table-action" data-label="Action">
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
    <div className="hrms-table-wrap" onMouseDown={handleTableMouseDragStart}>
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
              <td data-label="Employee">
                <div className="hrms-person-cell">
                  <EmployeeAvatar employee={employee} />
                  <div>
                    <strong>{displayValue(employee.name || employee.employee_name)}</strong>
                    <small>{displayValue(employee.email || employee.official_email)}</small>
                  </div>
                </div>
              </td>
              <td data-label="Code">
                <strong>{displayValue(employee.emp_code || employee.employee_id)}</strong>
                <small>{displayValue(employee.employee_id, '')}</small>
              </td>
              <td data-label="Department">{displayValue(employee.department)}</td>
              <td data-label="Designation">{displayValue(employee.designation)}</td>
              <td data-label="Exit Type">{displayValue(employee.exit_type)}</td>
              <td data-label="Last Working Date">{displayDate(employee.last_working_date || employee.resignation_date)}</td>
              <td data-label="Reason">{displayValue(employee.resignation_reason)}</td>
              <td data-label="Status">
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

function getSaasTenant(user = {}) {
  return user.tenant || user.company || {};
}

function getSaasSubscription(user = {}) {
  return user.subscription || user.saas_subscription || {};
}

function getSaasPlanType(user = {}) {
  const tenant = getSaasTenant(user);
  const subscription = getSaasSubscription(user);

  return String(
    subscription.plan_type ||
      tenant.plan_type ||
      user.plan_type ||
      '',
  )
    .trim()
    .toLowerCase();
}

function getSaasStatus(user = {}) {
  const tenant = getSaasTenant(user);
  const subscription = getSaasSubscription(user);

  return String(
    subscription.status ||
      tenant.status ||
      user.subscription_status ||
      user.status ||
      '',
  )
    .trim()
    .toLowerCase();
}

function getSaasEmployeeLimit(user = {}) {
  const tenant = getSaasTenant(user);
  const subscription = getSaasSubscription(user);

  if (
    subscription.is_unlimited_employees === true ||
    tenant.is_unlimited_employees === true ||
    user.is_unlimited_employees === true
  ) {
    return null;
  }

  const rawLimit =
    subscription.employee_limit ??
    tenant.employee_limit ??
    user.employee_limit ??
    '';

  if (rawLimit === null || rawLimit === undefined || rawLimit === '') {
    return null;
  }

  const parsed = Number(rawLimit);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getSaasPlanName(user = {}) {
  const tenant = getSaasTenant(user);
  const subscription = getSaasSubscription(user);

  return String(
    subscription.selected_plan_name ||
      subscription.plan_label ||
      subscription.plan_name ||
      subscription.plan ||
      tenant.selected_plan_name ||
      tenant.plan_label ||
      tenant.plan_name ||
      tenant.plan ||
      user.selected_plan_name ||
      user.plan_label ||
      user.plan_name ||
      'Current'
  ).trim();
}

function demoHasFullTrialAccess(user = {}) {
  const tenant = getSaasTenant(user);
  const subscription = getSaasSubscription(user);
  const allowedModules = subscription.allowed_modules || tenant.allowed_modules || user.allowed_modules || [];

  return (
    subscription.demo_has_full_access === true ||
    tenant.demo_has_full_access === true ||
    user.demo_has_full_access === true ||
    (Array.isArray(allowedModules) && (allowedModules.includes('all') || allowedModules.includes('*'))) ||
    (typeof allowedModules === 'string' && allowedModules.toLowerCase().split(',').map((item) => item.trim()).includes('all'))
  );
}

function getTrialEndDate(user = {}) {
  const tenant = getSaasTenant(user);
  const subscription = getSaasSubscription(user);

  return (
    subscription.trial_end_date ||
    subscription.end_date ||
    tenant.trial_end_date ||
    tenant.subscription_end_date ||
    user.trial_end_date ||
    user.subscription_end_date ||
    ''
  );
}

function getPaidSubscriptionEndDate(user = {}) {
  const tenant = getSaasTenant(user);
  const subscription = getSaasSubscription(user);

  return (
    subscription.next_payment_due_date ||
    subscription.subscription_end_date ||
    subscription.current_period_end ||
    subscription.paid_until ||
    subscription.end_date ||
    tenant.next_payment_due_date ||
    tenant.subscription_end_date ||
    tenant.current_period_end ||
    tenant.paid_until ||
    user.next_payment_due_date ||
    user.subscription_end_date ||
    user.current_period_end ||
    user.paid_until ||
    ''
  );
}

function calculateSaasDaysLeft(value) {
  if (!value) {
    return null;
  }

  const endDate = new Date(value);

  if (Number.isNaN(endDate.getTime())) {
    return null;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  endDate.setHours(23, 59, 59, 999);

  return Math.ceil((endDate.getTime() - today.getTime()) / 86400000);
}

function formatSaasDate(value) {
  if (!value) {
    return 'Not available';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export default function Employees({ user = {}, setPage } = {}) {
  const [activeTab, setActiveTab] = useState('master');
  const [activeAlumniSection, setActiveAlumniSection] = useState('employees');
  const [employees, setEmployees] = useState([]);
  const [alumni, setAlumni] = useState([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [loadingAlumni, setLoadingAlumni] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '', scope: 'page' });
  const messageTimerRef = useRef(null);

  const [employeePage, setEmployeePage] = useState(1);
  const [employeePageSize, setEmployeePageSize] = useState(10);
  const [alumniPage, setAlumniPage] = useState(1);
  const [alumniPageSize, setAlumniPageSize] = useState(10);

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

  const [filters, setFilters] = useState({ q: '', department: '', designation: '', state: '', employment_status: '' });
  const [alumniFilters, setAlumniFilters] = useState({ q: '', department: '', designation: '', state: '', employment_status: '' });
  const [resignEmployee, setResignEmployee] = useState(null);
  const [resignForm, setResignForm] = useState(EMPTY_RESIGN_FORM);

  const employeeDepartments = useMemo(() => uniqueOptions(employees, 'department'), [employees]);
  const employeeDesignations = useMemo(() => uniqueOptions(employees, 'designation'), [employees]);
  const employeeStates = useMemo(() => uniqueStateOptions(employees), [employees]);
  const alumniDepartments = useMemo(() => uniqueOptions(alumni, 'department'), [alumni]);
  const alumniDesignations = useMemo(() => uniqueOptions(alumni, 'designation'), [alumni]);
  const alumniStates = useMemo(() => uniqueStateOptions(alumni), [alumni]);

  const filteredEmployees = useMemo(() => filterEmployees(employees, filters), [employees, filters]);
  const filteredAlumni = useMemo(() => filterEmployees(alumni, alumniFilters), [alumni, alumniFilters]);

  const employeePageCount = pageCountFor(filteredEmployees, employeePageSize);
  const alumniPageCount = pageCountFor(filteredAlumni, alumniPageSize);

  const pagedEmployees = useMemo(
    () =>
      paginateRows(
        filteredEmployees,
        Math.min(employeePage, employeePageCount),
        employeePageSize,
      ),
    [
      filteredEmployees,
      employeePage,
      employeePageCount,
      employeePageSize,
    ],
  );

  const pagedAlumni = useMemo(
    () =>
      paginateRows(
        filteredAlumni,
        Math.min(alumniPage, alumniPageCount),
        alumniPageSize,
      ),
    [
      filteredAlumni,
      alumniPage,
      alumniPageCount,
      alumniPageSize,
    ],
  );

  const employeeStats = useMemo(() => ({
    active: employees.length,
    departments: uniqueOptions(employees, 'department').length,
    designations: uniqueOptions(employees, 'designation').length,
    alumni: alumni.length,
  }), [employees, alumni]);

  const saasPlanType = getSaasPlanType(user);
  const saasStatus = getSaasStatus(user);
  const saasEmployeeLimit = getSaasEmployeeLimit(user);
  const saasPlanName = getSaasPlanName(user);
  const isDemoTenant = saasPlanType === 'demo';
  const isPaidTenant = saasPlanType === 'paid';
  const isExpiredOrSuspendedTenant = [
    'expired',
    'subscription_expired',
    'trial_expired',
    'demo_expired',
    'suspended',
    'blocked',
  ].includes(saasStatus);
  const paidSubscriptionEndDate = getPaidSubscriptionEndDate(user);
  const paidSubscriptionDaysLeft = calculateSaasDaysLeft(paidSubscriptionEndDate);
  const isPaidRenewalDueSoon = Boolean(
    isPaidTenant &&
      !isExpiredOrSuspendedTenant &&
      paidSubscriptionDaysLeft !== null &&
      paidSubscriptionDaysLeft >= 0 &&
      paidSubscriptionDaysLeft <= 7,
  );
  const hasFullTrialAccess = isDemoTenant && !isExpiredOrSuspendedTenant && demoHasFullTrialAccess(user);
  const hasPaidEmployeeLimit = isPaidTenant && saasEmployeeLimit;
  const employeesUsedForLimit = employees.length;
  const paidEmployeesRemaining = hasPaidEmployeeLimit
    ? Math.max(saasEmployeeLimit - employeesUsedForLimit, 0)
    : null;
  const isPaidEmployeeLimitReached = Boolean(
    hasPaidEmployeeLimit && employeesUsedForLimit >= saasEmployeeLimit,
  );

  const clearMessage = () => {
    if (messageTimerRef.current) {
      window.clearTimeout(messageTimerRef.current);
      messageTimerRef.current = null;
    }

    setMessage({ type: '', text: '', scope: 'page' });
  };

  const showMessage = (type, text, title = '', options = {}) => {
    if (messageTimerRef.current) {
      window.clearTimeout(messageTimerRef.current);
      messageTimerRef.current = null;
    }

    setMessage({
      type,
      text,
      title,
      loading: Boolean(options.loading),
      scope: options.scope || 'page',
    });

    if (!options.loading) {
      messageTimerRef.current = window.setTimeout(() => {
        setMessage({ type: '', text: '', scope: 'page' });
        messageTimerRef.current = null;
      }, EMPLOYEE_NOTICE_HIDE_MS);
    }
  };

  const openBillingPage = () => {
    if (typeof setPage === 'function') {
      setPage('billing');
    }

    try {
      window.history.pushState({}, '', '/billing');
    } catch {
      // Ignore browser history errors.
    }
  };

  const loadFormOptions = async (feedbackScope = 'page') => {
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
      return true;
    } catch (error) {
      showMessage(
        'error',
        error.message || 'Unable to load employee form dropdowns.',
        'Employee Data Load Failed',
        { scope: feedbackScope },
      );
      return false;
    }
  };

  const loadEmployees = async (feedbackScope = 'page') => {
    setLoadingEmployees(true);
    try {
      const data = await getActiveEmployees({ limit: 500, sort_by: 'created_at', sort_dir: 'desc' });
      setEmployees(data.items || []);
      return true;
    } catch (error) {
      showMessage(
        'error',
        error.message || 'Unable to load employees.',
        'Employee Load Failed',
        { scope: feedbackScope },
      );
      return false;
    } finally {
      setLoadingEmployees(false);
    }
  };

  const loadAlumni = async (feedbackScope = 'page') => {
    setLoadingAlumni(true);
    try {
      const data = await getAlumniEmployees({ limit: 500, sort_by: 'last_working_date', sort_dir: 'desc' });
      setAlumni(data.items || []);
      return true;
    } catch (error) {
      showMessage(
        'error',
        error.message || 'Unable to load alumni employees.',
        'Alumni Load Failed',
        { scope: feedbackScope },
      );
      return false;
    } finally {
      setLoadingAlumni(false);
    }
  };

  const reloadAll = async ({ feedbackScope = '' } = {}) => {
    if (feedbackScope) {
      showMessage(
        'info',
        'Refreshing employee, alumni and form-option data...',
        'Refreshing',
        { loading: true, scope: feedbackScope },
      );
    }

    const results = await Promise.all([
      loadFormOptions(feedbackScope || 'page'),
      loadEmployees(feedbackScope || 'page'),
      loadAlumni(feedbackScope || 'page'),
    ]);

    if (feedbackScope) {
      if (results.every(Boolean)) {
        showMessage(
          'success',
          'Employee management data refreshed successfully.',
          'Refresh Complete',
          { scope: feedbackScope },
        );
      } else {
        showMessage(
          'error',
          'Some employee management data could not be refreshed. Please try again.',
          'Refresh Failed',
          { scope: feedbackScope },
        );
      }
    }

    return results;
  };

  useEffect(() => {
    reloadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setEmployeePage((current) => Math.min(current, employeePageCount));
  }, [employeePageCount]);

  useEffect(() => {
    setAlumniPage((current) => Math.min(current, alumniPageCount));
  }, [alumniPageCount]);

  useEffect(() => {
    if (
      (!editingEmployee && !resignEmployee) ||
      typeof document === 'undefined'
    ) {
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
      const modal = event.target?.closest?.('.hrms-modal');

      if (modal) return;
      event.preventDefault();
    };

    const closeOnEscape = (event) => {
      if (event.key !== 'Escape' || saving) return;

      if (resignEmployee) {
        closeResignModal();
        return;
      }

      if (editingEmployee) {
        closeEditModal();
      }
    };

    document.addEventListener('wheel', blockBackgroundScroll, {
      passive: false,
    });
    document.addEventListener('touchmove', blockBackgroundScroll, {
      passive: false,
    });
    window.addEventListener('keydown', closeOnEscape);

    return () => {
      document.removeEventListener('wheel', blockBackgroundScroll);
      document.removeEventListener('touchmove', blockBackgroundScroll);
      window.removeEventListener('keydown', closeOnEscape);
      body.style.overflow = previousBodyOverflow;
      root.style.overflow = previousRootOverflow;
      body.style.overscrollBehavior = previousBodyOverscroll;
      root.style.overscrollBehavior = previousRootOverscroll;
    };
  }, [editingEmployee, resignEmployee, saving]);

  useEffect(() => {
    const dismissMessage = (event) => {
      if (event.target?.closest?.('.hrms-inline-feedback')) return;

      if (messageTimerRef.current) {
        window.clearTimeout(messageTimerRef.current);
        messageTimerRef.current = null;
      }

      setMessage((current) =>
        current.text
          ? { type: '', text: '', scope: 'page' }
          : current,
      );
    };

    document.addEventListener('pointerdown', dismissMessage);

    return () => {
      document.removeEventListener('pointerdown', dismissMessage);

      if (messageTimerRef.current) {
        window.clearTimeout(messageTimerRef.current);
        messageTimerRef.current = null;
      }
    };
  }, []);

  const handleFilterChange = (event) => {
    setEmployeePage(1);
    setFilters((previous) => ({
      ...previous,
      [event.target.name]: event.target.value,
    }));
  };

  const handleAlumniFilterChange = (event) => {
    setAlumniPage(1);
    setAlumniFilters((previous) => ({
      ...previous,
      [event.target.name]: event.target.value,
    }));
  };

  const resetFilters = () => {
    setEmployeePage(1);
    setFilters({
      q: '',
      department: '',
      designation: '',
      state: '',
      employment_status: '',
    });
  };

  const resetAlumniFilters = () => {
    setAlumniPage(1);
    setAlumniFilters({
      q: '',
      department: '',
      designation: '',
      state: '',
      employment_status: '',
    });
  };

  const handleDownloadEmployeeExcel = async () => {
    showMessage(
      'info',
      'Preparing the active employee Excel report...',
      'Preparing Download',
      { loading: true, scope: 'master-actions' },
    );

    try {
      await downloadEmployeeMasterExcel(filters);
      showMessage(
        'success',
        'Active employee Excel report download started successfully.',
        'Download Ready',
        { scope: 'master-actions' },
      );
    } catch (error) {
      showMessage(
        'error',
        error.message || 'Unable to download employee Excel report.',
        'Download Failed',
        { scope: 'master-actions' },
      );
    }
  };

  const handleDownloadAlumniCsv = async () => {
    showMessage(
      'info',
      'Preparing the alumni CSV report...',
      'Preparing Download',
      { loading: true, scope: 'alumni-actions' },
    );

    try {
      await Promise.resolve(downloadAlumniCsv(filteredAlumni));
      showMessage(
        'success',
        'Alumni CSV report download started successfully.',
        'Download Ready',
        { scope: 'alumni-actions' },
      );
    } catch (error) {
      showMessage(
        'error',
        error.message || 'Unable to download alumni CSV report.',
        'Download Failed',
        { scope: 'alumni-actions' },
      );
    }
  };

  const handleCreateEmployee = async (event) => {
    event.preventDefault();

    if (isExpiredOrSuspendedTenant) {
      showMessage('error', 'Your trial/subscription is expired or suspended. Please upgrade to continue.', 'Access Restricted', { scope: 'create' });
      openBillingPage();
      return;
    }

    if (isPaidEmployeeLimitReached) {
      if (isPaidRenewalDueSoon) {
        showMessage(
          'error',
          `Your ${saasPlanName} plan allows only ${saasEmployeeLimit} employees. Renew or change the plan from Billing to continue.`,
          'Employee Limit Reached',
          { scope: 'create' },
        );
        openBillingPage();
      } else {
        showMessage(
          'error',
          `Your ${saasPlanName} employee limit has been reached. Upgrade controls stay hidden while the subscription is active. Contact Superadmin for an immediate plan revision.`,
          'Employee Limit Reached',
          { scope: 'create' },
        );
      }
      return;
    }

    setSaving(true);
    showMessage(
      'info',
      'Creating the employee record...',
      'Creating Employee',
      { loading: true, scope: 'create' },
    );

    try {
      await createEmployee(employeePayloadFromForm(employeeForm, { status: 'active', employment_status: 'active', is_alumni: false }));
      setEmployeeForm(EMPTY_EMPLOYEE_FORM);
      setTeamLeaderSearch('');
      setReportingOfficerSearch('');
      await loadEmployees();
      setActiveTab('master');
      showMessage(
        'success',
        'Employee created successfully.',
        'Employee Created',
        { scope: 'master-actions' },
      );
    } catch (error) {
      showMessage(
        'error',
        error.message || 'Unable to create employee.',
        'Employee Creation Failed',
        { scope: 'create' },
      );
    } finally {
      setSaving(false);
    }
  };

  const handleCreatePastEmployee = async (event) => {
    event.preventDefault();
    setSaving(true);
    showMessage(
      'info',
      'Adding the past employee to Alumni...',
      'Adding Past Employee',
      { loading: true, scope: 'alumni-create' },
    );

    try {
      await createPastEmployee(employeePayloadFromForm(alumniForm, {
        is_alumni: true,
        skip_login: true,
        status: 'Resigned',
        employment_status: 'Resigned',
      }));
      setAlumniForm(EMPTY_ALUMNI_FORM);
      await loadAlumni();
      setActiveAlumniSection('employees');
      showMessage(
        'success',
        'Past employee added to alumni successfully.',
        'Alumni Updated',
        { scope: 'alumni-actions' },
      );
    } catch (error) {
      showMessage(
        'error',
        error.message || 'Unable to add past employee.',
        'Unable To Add Past Employee',
        { scope: 'alumni-create' },
      );
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
      showMessage(
        'error',
        'Employee ID not found.',
        'Employee Update Failed',
        { scope: 'edit-modal' },
      );
      return;
    }

    setSaving(true);
    showMessage(
      'info',
      'Saving the employee changes...',
      'Updating Employee',
      { loading: true, scope: 'edit-modal' },
    );

    try {
      await updateEmployee(id, employeePayloadFromForm(editForm));
      closeEditModal();
      await reloadAll();
      showMessage(
        'success',
        'Employee updated successfully.',
        'Employee Updated',
        { scope: 'master-actions' },
      );
    } catch (error) {
      showMessage(
        'error',
        error.message || 'Unable to update employee.',
        'Employee Update Failed',
        { scope: 'edit-modal' },
      );
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
      showMessage(
        'error',
        'Employee ID not found.',
        'Resignation Update Failed',
        { scope: 'resign-modal' },
      );
      return;
    }

    setSaving(true);
    showMessage(
      'info',
      'Moving the employee to Alumni...',
      'Updating Employee Status',
      { loading: true, scope: 'resign-modal' },
    );

    try {
      await markEmployeeAsResigned(id, {
        ...resignForm,
        status: 'Resigned',
        employment_status: 'Resigned',
      });
      closeResignModal();
      await reloadAll();
      showMessage(
        'success',
        'Employee moved to alumni successfully.',
        'Employee Moved To Alumni',
        { scope: 'master-actions' },
      );
    } catch (error) {
      showMessage(
        'error',
        error.message || 'Unable to mark employee as resigned.',
        'Resignation Update Failed',
        { scope: 'resign-modal' },
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="hrms-employees-page">
      <style>{`
        @keyframes hrmsEmployeeSpin {
          to { transform: rotate(360deg); }
        }

        @keyframes hrmsEmployeeRefreshIdle {
          0%, 84% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        @keyframes hrmsEmployeeSectionReveal {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes hrmsEmployeeModalFade {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes hrmsEmployeeModalIn {
          from { opacity: 0; transform: translateY(24px) scale(.985); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        .hrms-employees-page {
          --emp-ink: #101a3a;
          --emp-soft: #5d6d8d;
          --emp-violet: #4d77dd;
          --emp-deep: #575092;
          --emp-blue: #4d77dd;
          --emp-cyan: #2eb2b9;
          --emp-teal: #2eb2b9;
          --emp-yellow: #d8ff43;
          --emp-danger: #d84d68;
          --emp-line: rgba(16, 26, 58, .14);
          --emp-flat-blue: #b9d7ff;
          --emp-flat-violet: #c9c0ff;
          --emp-flat-teal: #aee6d9;
          --emp-ease: cubic-bezier(.22, 1, .36, 1);

          display: grid;
          gap: clamp(16px, 1.8vw, 24px);
          width: 100%;
          min-width: 0;
          max-width: 100%;
          padding-bottom: max(18px, env(safe-area-inset-bottom));
          color: var(--emp-ink);
          background: transparent;
          font-family: var(--yc-ui, var(--body), inherit);
        }

        .hrms-employees-page,
        .hrms-employees-page * {
          box-sizing: border-box;
        }

        .hrms-employees-page > *,
        .hrms-employees-page section,
        .hrms-employees-page article,
        .hrms-employees-page form,
        .hrms-employees-page nav,
        .hrms-employees-page aside,
        .hrms-employees-page label {
          min-width: 0;
          max-width: 100%;
        }

        .hrms-employees-page h1,
        .hrms-employees-page h2,
        .hrms-employees-page h3,
        .hrms-employees-page h4,
        .hrms-employees-page p,
        .hrms-employees-page strong,
        .hrms-employees-page small,
        .hrms-employees-page span,
        .hrms-employees-page td,
        .hrms-employees-page th {
          overflow-wrap: anywhere;
        }

        .hrms-employees-page button,
        .hrms-employees-page input,
        .hrms-employees-page select,
        .hrms-employees-page textarea {
          font: inherit;
          max-width: 100%;
        }

        .hrms-employees-page button {
          min-width: 0;
          cursor: pointer;
        }

        .hrms-spin {
          animation: hrmsEmployeeSpin 1s linear infinite;
        }

        .hrms-hero {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(190px, 300px);
          gap: clamp(20px, 3vw, 36px);
          align-items: center;
          min-height: 250px;
          padding: clamp(24px, 3vw, 40px);
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
            10px 12px 0 #b9d7ff,
            0 26px 44px rgba(70, 92, 140, .12);
        }

        .hrms-hero-content {
          display: contents;
        }

        .hrms-kicker,
        .hrms-section-kicker {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          width: max-content;
          max-width: 100%;
          border-radius: 999px;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          font-size: 9px;
          font-weight: 950;
          line-height: 1;
          letter-spacing: .12em;
          text-transform: uppercase;
        }

        .hrms-kicker {
          margin-bottom: 15px;
          padding: 9px 13px;
          box-shadow: 4px 5px 0 #575092;
        }

        .hrms-section-kicker {
          margin-bottom: 10px;
          padding: 7px 10px;
          box-shadow: 3px 4px 0 #575092;
        }

        .hrms-hero h1 {
          max-width: 900px;
          margin: 0;
          color: var(--emp-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(44px, 5.2vw, 77px);
          font-weight: 760;
          line-height: .94;
          letter-spacing: -.058em;
        }

        .hrms-hero h1 em {
          color: var(--emp-violet);
          font-family: Georgia, "Times New Roman", serif;
          font-weight: 500;
        }

        .hrms-hero p {
          max-width: 840px;
          margin: 17px 0 0;
          color: var(--emp-soft);
          font-size: clamp(13px, 1vw, 16px);
          line-height: 1.68;
        }

        .hrms-hero-actions {
          display: flex;
          justify-content: flex-end;
          width: 100%;
        }

        .hrms-action-stack {
          width: min(320px, 100%);
          display: grid;
          gap: 9px;
        }

        .hrms-refresh-btn,
        .hrms-primary-btn,
        .hrms-secondary-btn,
        .hrms-danger-soft-btn,
        .hrms-tab-btn,
        .hrms-alumni-subtab-btn,
        .hrms-page-button,
        .hrms-page-number,
        .hrms-inline-feedback-close {
          appearance: none;
          font-weight: 900;
          transition:
            transform 190ms ease,
            box-shadow 190ms ease,
            filter 190ms ease,
            opacity 190ms ease;
        }

        .hrms-refresh-btn {
          min-height: 54px;
          padding: 10px 18px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          border: 1px solid rgba(77, 119, 221, .18);
          border-radius: 15px;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow:
            6px 7px 0 #575092,
            0 14px 25px rgba(67, 116, 170, .12);
          white-space: nowrap;
        }

        .hrms-refresh-btn svg:first-child {
          animation: hrmsEmployeeRefreshIdle 4.2s linear infinite;
        }

        .hrms-refresh-btn:disabled svg:first-child {
          animation: hrmsEmployeeSpin 1s linear infinite;
        }

        .hrms-refresh-btn:hover:not(:disabled),
        .hrms-primary-btn:hover:not(:disabled),
        .hrms-secondary-btn:hover:not(:disabled),
        .hrms-danger-soft-btn:hover:not(:disabled),
        .hrms-page-button:hover:not(:disabled),
        .hrms-page-number:hover:not(:disabled) {
          transform: translateY(-2px);
          filter: saturate(1.04);
        }

        .hrms-refresh-btn:disabled,
        .hrms-primary-btn:disabled,
        .hrms-secondary-btn:disabled,
        .hrms-danger-soft-btn:disabled,
        .hrms-page-button:disabled,
        .hrms-page-number:disabled {
          opacity: .58;
          cursor: not-allowed;
          transform: none;
        }

        .hrms-stats-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
        }

        .hrms-stat-card {
          min-width: 0;
          min-height: 120px;
          padding: 18px;
          border: 1px solid rgba(171, 181, 211, .66);
          border-radius: 22px;
          background: #edf6ff;
          box-shadow:
            7px 9px 0 #b9d7ff,
            0 18px 30px rgba(34, 38, 110, .09);
          transition: transform 190ms ease;
        }

        .hrms-stat-card:nth-child(2) {
          background: #eaf8f4;
          box-shadow:
            7px 9px 0 #aee6d9,
            0 18px 30px rgba(34, 38, 110, .09);
        }

        .hrms-stat-card:nth-child(3) {
          background: #fff4d5;
          box-shadow:
            7px 9px 0 #ffe0a5,
            0 18px 30px rgba(34, 38, 110, .09);
        }

        .hrms-stat-card:nth-child(4) {
          background: #f1efff;
          box-shadow:
            7px 9px 0 #c9c0ff,
            0 18px 30px rgba(34, 38, 110, .09);
        }

        .hrms-stat-card:hover {
          transform: translateY(-4px);
        }

        .hrms-stat-card span {
          display: block;
          color: #5d6785;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: .09em;
          text-transform: uppercase;
        }

        .hrms-stat-card strong {
          display: block;
          margin-top: 10px;
          color: var(--emp-ink);
          font-family: Georgia, "Times New Roman", serif;
          font-size: clamp(30px, 3vw, 43px);
          line-height: 1;
        }

        .hrms-section-tabs-holder {
          width: 100%;
          min-width: 0;
          max-width: 100%;
        }

        .hrms-tabs {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
          width: 100%;
          padding: 12px;
          border: 1px solid rgba(171, 181, 211, .62);
          border-radius: 22px;
          background: #fff;
          box-shadow:
            6px 7px 0 #c4ccff,
            0 16px 28px rgba(34, 38, 110, .08);
        }

        .hrms-tab-btn {
          min-width: 0;
          min-height: 62px;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          gap: 10px;
          align-items: center;
          padding: 11px 14px;
          border: 1px solid rgba(77, 119, 221, .22);
          border-radius: 16px;
          color: #4767b4;
          background: linear-gradient(135deg, #f0f5ff 0%, #eefcfb 100%);
          box-shadow: 3px 4px 0 rgba(87, 80, 146, .16);
          text-align: left;
        }

        .hrms-tab-btn:hover {
          transform: translateY(-2px);
          border-color: rgba(46, 178, 185, .46);
        }

        .hrms-tab-btn.active {
          border-color: transparent;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow: 5px 6px 0 #575092;
        }

        .hrms-tab-copy {
          min-width: 0;
          display: grid;
          gap: 3px;
        }

        .hrms-tab-copy strong {
          font-size: 12px;
          font-weight: 950;
          line-height: 1.2;
        }

        .hrms-tab-copy small {
          color: currentColor;
          font-size: 9px;
          font-weight: 700;
          line-height: 1.35;
          opacity: .78;
        }

        .hrms-tab-count {
          min-width: 28px;
          height: 28px;
          padding: 0 7px;
          display: inline-grid;
          place-items: center;
          border-radius: 999px;
          color: #40348d;
          background: #fff;
          box-shadow: 2px 3px 0 rgba(52, 43, 120, .10);
          font-size: 9px;
          font-weight: 950;
        }

        .hrms-section-content {
          width: 100%;
          min-width: 0;
          animation: hrmsEmployeeSectionReveal 220ms ease both;
        }

        .hrms-panel,
        .hrms-form-card {
          min-width: 0;
          width: 100%;
          padding: clamp(18px, 2vw, 28px);
          overflow: hidden;
          border: 1px solid rgba(171, 181, 211, .70);
          border-radius: clamp(26px, 2.2vw, 36px);
          background: #fff;
          box-shadow:
            8px 10px 0 #c4ccff,
            0 24px 42px rgba(34, 38, 110, .10);
        }

        .hrms-section-heading {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          width: 100%;
          min-width: 0;
          margin-bottom: 18px;
        }

        .hrms-section-heading > div {
          flex: 1 1 auto;
          min-width: 0;
        }

        .hrms-section-heading h3,
        .hrms-section-heading h2 {
          margin: 0;
          color: var(--emp-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(25px, 2.3vw, 37px);
          font-weight: 760;
          line-height: 1;
          letter-spacing: -.045em;
        }

        .hrms-section-heading p {
          margin: 8px 0 0;
          color: var(--emp-soft);
          font-size: 13px;
          line-height: 1.58;
        }

        .hrms-actions,
        .hrms-row-actions,
        .hrms-form-actions,
        .hrms-modal-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 10px;
          flex-wrap: wrap;
        }

        .hrms-primary-btn,
        .hrms-secondary-btn,
        .hrms-danger-soft-btn {
          min-height: 44px;
          padding: 9px 14px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          border-radius: 15px;
        }

        .hrms-primary-btn {
          border: 0;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow: 5px 6px 0 #575092;
        }

        .hrms-secondary-btn {
          border: 1px solid rgba(77, 119, 221, .18);
          color: #40348d;
          background: #f1efff;
          box-shadow: 4px 5px 0 #c9c0ff;
        }

        .hrms-danger-soft-btn {
          border: 1px solid rgba(216, 77, 104, .18);
          color: #a2344d;
          background: #fff0f2;
          box-shadow: 4px 5px 0 #f2c2cc;
        }

        .hrms-primary-btn.compact,
        .hrms-secondary-btn.compact,
        .hrms-danger-soft-btn.compact {
          min-height: 36px;
          padding: 7px 10px;
          border-radius: 11px;
          font-size: 10px;
        }

        .hrms-plan-alert {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          flex-wrap: wrap;
          width: 100%;
          padding: 15px 16px;
          border: 1px solid rgba(77, 119, 221, .20);
          border-radius: 18px;
          color: #40348d;
          background: #f1efff;
          box-shadow: 4px 5px 0 #c9c0ff;
          font-size: 11px;
          line-height: 1.55;
        }

        .hrms-plan-alert.success {
          border-color: rgba(4, 120, 87, .18);
          color: #047857;
          background: #eaf8f4;
          box-shadow: 4px 5px 0 #aee6d9;
        }

        .hrms-plan-alert.error {
          border-color: rgba(162, 52, 77, .18);
          color: #a2344d;
          background: #fff0f2;
          box-shadow: 4px 5px 0 #f2c2cc;
        }

        .hrms-plan-alert strong {
          display: block;
          margin-bottom: 4px;
          font-weight: 950;
        }

        .hrms-inline-feedback {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          gap: 9px;
          align-items: start;
          width: 100%;
          min-width: 0;
          padding: 10px 11px;
          border: 1px solid rgba(102, 88, 220, .18);
          border-radius: 12px;
          color: #40348d;
          background: #f1efff;
          box-shadow: 3px 4px 0 #c9c0ff;
          font-size: 10px;
          line-height: 1.45;
        }

        .hrms-inline-feedback.success {
          border-color: rgba(4, 120, 87, .18);
          color: #047857;
          background: #eaf8f4;
          box-shadow: 3px 4px 0 #aee6d9;
        }

        .hrms-inline-feedback.warning {
          border-color: rgba(154, 104, 23, .18);
          color: #9a6817;
          background: #fff4d5;
          box-shadow: 3px 4px 0 #ffe0a5;
        }

        .hrms-inline-feedback.error {
          border-color: rgba(162, 52, 77, .18);
          color: #a2344d;
          background: #fff0f2;
          box-shadow: 3px 4px 0 #f2c2cc;
        }

        .hrms-inline-feedback-icon {
          width: 22px;
          height: 22px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex: 0 0 22px;
        }

        .hrms-inline-feedback-copy {
          min-width: 0;
        }

        .hrms-inline-feedback-copy strong,
        .hrms-inline-feedback-copy span {
          display: block;
        }

        .hrms-inline-feedback-copy strong {
          margin-bottom: 2px;
          font-weight: 950;
        }

        .hrms-inline-feedback-copy span {
          font-weight: 750;
        }

        .hrms-inline-feedback-close {
          width: 24px;
          min-width: 24px;
          height: 24px;
          display: inline-grid;
          place-items: center;
          margin: -2px -3px -2px 0;
          padding: 0;
          border: 0;
          border-radius: 8px;
          color: currentColor;
          background: rgba(255, 255, 255, .58);
          box-shadow: none;
          font-size: 17px;
          line-height: 1;
        }

        .hrms-inline-feedback-close:hover {
          transform: none;
          filter: none;
          background: #fff;
        }

        .hrms-filter-grid {
          display: grid;
          grid-template-columns:
            auto
            minmax(220px, 1.45fr)
            repeat(4, minmax(135px, .9fr))
            auto;
          gap: 10px;
          align-items: stretch;
          width: 100%;
          min-width: 0;
          margin-bottom: 18px;
          padding: 12px;
          border: 1px solid rgba(171, 181, 211, .55);
          border-radius: 18px;
          background: #f8f9ff;
          box-shadow: 3px 4px 0 rgba(52, 43, 120, .07);
        }

        .hrms-filter-label {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          align-self: center;
          color: #5d6785;
          font-size: 10px;
          font-weight: 950;
          letter-spacing: .08em;
          text-transform: uppercase;
          white-space: nowrap;
        }

        .hrms-search-wrap {
          position: relative;
          min-width: 0;
        }

        .hrms-search-wrap svg {
          position: absolute;
          left: 13px;
          top: 50%;
          color: #6c7da2;
          transform: translateY(-50%);
          pointer-events: none;
        }

        .hrms-search-wrap input {
          padding-left: 38px;
        }

        .hrms-filter-grid input,
        .hrms-filter-grid select,
        .hrms-field input,
        .hrms-field select,
        .hrms-field textarea,
        .hrms-searchable-field input,
        .hrms-searchable-field select,
        .hrms-modal input,
        .hrms-modal select,
        .hrms-modal textarea {
          width: 100%;
          min-width: 0;
          min-height: 49px;
          padding: 0 14px;
          border: 1px solid rgba(151, 161, 197, .58);
          border-radius: 15px;
          outline: 0;
          color: var(--emp-ink);
          background: rgba(255, 255, 255, .96);
          font-size: 13px;
          transition:
            border-color 170ms ease,
            box-shadow 170ms ease,
            transform 170ms ease;
        }

        .hrms-field textarea,
        .hrms-modal textarea {
          min-height: 120px;
          padding: 14px;
          resize: vertical;
        }

        .hrms-filter-grid input:focus,
        .hrms-filter-grid select:focus,
        .hrms-field input:focus,
        .hrms-field select:focus,
        .hrms-field textarea:focus,
        .hrms-searchable-field input:focus,
        .hrms-searchable-field select:focus {
          border-color: rgba(77, 119, 221, .65);
          box-shadow:
            4px 5px 0 rgba(87, 80, 146, .14),
            0 0 0 4px rgba(77, 119, 221, .08);
          transform: translateY(-1px);
        }

        .hrms-pagination {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          width: 100%;
          min-width: 0;
          margin: 0 0 15px;
          padding: 12px 13px;
          border: 1px solid rgba(171, 181, 211, .52);
          border-radius: 16px;
          background: #f8f9ff;
          box-shadow: 3px 4px 0 rgba(52, 43, 120, .07);
        }

        .hrms-pagination-copy {
          display: flex;
          align-items: baseline;
          gap: 6px;
          min-width: 0;
          color: var(--emp-soft);
          font-size: 10px;
          font-weight: 850;
        }

        .hrms-pagination-copy strong {
          color: var(--emp-ink);
          font-size: 13px;
          font-weight: 950;
        }

        .hrms-pagination-controls {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          min-width: 0;
          max-width: 100%;
          flex-wrap: wrap;
        }

        .hrms-page-size-control {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          color: var(--emp-soft);
          font-size: 10px;
          font-weight: 900;
          white-space: nowrap;
        }

        .hrms-page-size-control select {
          min-width: 108px;
          height: 38px;
          padding: 0 30px 0 10px;
          border: 1px solid rgba(77, 119, 221, .20);
          border-radius: 12px;
          color: #40348d;
          background: #f1efff;
          box-shadow: 2px 3px 0 #c9c0ff;
          font-size: 10px;
          font-weight: 900;
        }

        .hrms-page-button {
          min-width: 78px;
          height: 38px;
          padding: 0 11px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          border: 1px solid rgba(77, 119, 221, .18);
          border-radius: 12px;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow: 4px 5px 0 #575092;
          font-size: 10px;
        }

        .hrms-page-numbers {
          display: flex;
          align-items: center;
          gap: 5px;
        }

        .hrms-page-number {
          width: 36px;
          height: 36px;
          display: grid;
          place-items: center;
          border: 1px solid rgba(77, 119, 221, .20);
          border-radius: 11px;
          color: #4767b4;
          background: #fff;
          box-shadow: 2px 3px 0 rgba(87, 80, 146, .12);
          font-size: 10px;
        }

        .hrms-page-number.active {
          border-color: transparent;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow: 3px 4px 0 #575092;
        }

        .hrms-page-ellipsis {
          width: 20px;
          text-align: center;
          color: #7b88a5;
          font-weight: 900;
        }

        .hrms-page-indicator {
          min-width: 82px;
          color: var(--emp-soft);
          font-size: 10px;
          font-weight: 900;
          text-align: center;
          white-space: nowrap;
        }

        .hrms-table-wrap {
          width: 100%;
          min-width: 0;
          overflow-x: auto;
          overflow-y: hidden;
          border: 1px solid rgba(171, 181, 211, .54);
          border-radius: 18px;
          background: #fff;
          scrollbar-width: thin;
          scrollbar-color: #b9c7e8 #f4f6fb;
          cursor: grab;
        }

        .hrms-table-wrap.is-dragging {
          cursor: grabbing;
          user-select: none;
        }

        .hrms-table {
          width: 100%;
          min-width: 1050px;
          border-collapse: separate;
          border-spacing: 0;
          color: var(--emp-ink);
        }

        .hrms-table th {
          position: sticky;
          top: 0;
          z-index: 2;
          padding: 12px 13px;
          border-bottom: 1px solid rgba(171, 181, 211, .55);
          color: #5d6785;
          background: #f8f9ff;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: .08em;
          text-align: left;
          text-transform: uppercase;
          white-space: nowrap;
        }

        .hrms-table td {
          padding: 13px;
          border-bottom: 1px solid rgba(171, 181, 211, .32);
          color: #384564;
          font-size: 11px;
          line-height: 1.45;
          vertical-align: middle;
        }

        .hrms-table tbody tr {
          transition: background 170ms ease;
        }

        .hrms-table tbody tr:hover {
          background: #fbfcff;
        }

        .hrms-table tbody tr:last-child td {
          border-bottom: 0;
        }

        .hrms-table td > strong,
        .hrms-person-cell strong {
          display: block;
          color: var(--emp-ink);
          font-size: 11px;
          font-weight: 900;
        }

        .hrms-table td > small,
        .hrms-person-cell small {
          display: block;
          margin-top: 3px;
          color: #74809c;
          font-size: 9px;
          line-height: 1.4;
        }

        .hrms-table-action {
          min-width: 180px;
        }

        .hrms-person-cell {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 190px;
        }

        .hrms-employee-avatar {
          width: 38px;
          min-width: 38px;
          height: 38px;
          display: grid;
          place-items: center;
          overflow: hidden;
          border: 1px solid rgba(77, 119, 221, .18);
          border-radius: 12px;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow: 3px 4px 0 #c9c0ff;
          font-size: 11px;
          font-weight: 950;
          object-fit: cover;
        }

        .hrms-pill {
          display: inline-flex;
          align-items: center;
          padding: 6px 9px;
          border-radius: 999px;
          font-size: 9px;
          font-weight: 900;
          text-transform: capitalize;
          white-space: nowrap;
        }

        .hrms-pill-green {
          color: #047857;
          background: #eaf8f4;
          box-shadow: 2px 3px 0 #aee6d9;
        }

        .hrms-pill-red {
          color: #a2344d;
          background: #fff0f2;
          box-shadow: 2px 3px 0 #f2c2cc;
        }

        .hrms-empty-state {
          min-height: 180px;
          padding: 24px;
          display: grid;
          place-items: center;
          gap: 8px;
          border: 1px dashed rgba(77, 119, 221, .28);
          border-radius: 20px;
          color: var(--emp-soft);
          background: #fafbff;
          text-align: center;
        }

        .hrms-form-card {
          display: grid;
          gap: 18px;
        }

        .hrms-form-section {
          padding: clamp(15px, 1.8vw, 20px);
          border: 1px solid rgba(77, 119, 221, .16);
          border-radius: 20px;
          background: linear-gradient(135deg, #f8fbff 0%, #fbfffe 100%);
          box-shadow: 4px 5px 0 rgba(87, 80, 146, .10);
        }

        .hrms-form-section h4 {
          margin: 0 0 14px;
          color: #4767b4;
          font-size: 11px;
          font-weight: 950;
          letter-spacing: .06em;
          text-transform: uppercase;
        }

        .hrms-form-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
        }

        .hrms-field {
          display: block;
          min-width: 0;
        }

        .hrms-field > span {
          display: block;
          margin-bottom: 8px;
          color: #303b5b;
          font-size: 11px;
          font-weight: 900;
        }

        .hrms-field > span b {
          margin-left: 3px;
          color: var(--emp-danger);
        }

        .hrms-searchable-field {
          display: grid;
          gap: 8px;
        }

        .hrms-searchable-field > span {
          margin-bottom: 0;
        }

        .hrms-checkbox-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }

        .hrms-checkbox {
          min-height: 48px;
          padding: 12px 14px;
          display: flex;
          align-items: center;
          gap: 10px;
          border: 1px solid rgba(77, 119, 221, .16);
          border-radius: 15px;
          color: #384564;
          background: #f8f9ff;
          font-size: 11px;
          font-weight: 850;
        }

        .hrms-checkbox input {
          width: 16px;
          min-width: 16px;
          height: 16px;
          accent-color: #4d77dd;
        }

        .hrms-form-note {
          color: #6b7897;
          font-size: 10px;
          line-height: 1.55;
        }

        .hrms-form-actions {
          padding-top: 2px;
        }

        .hrms-alumni-layout {
          display: grid;
          gap: 16px;
        }

        .hrms-alumni-subtabs {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          width: 100%;
          padding: 10px;
          border: 1px solid rgba(171, 181, 211, .55);
          border-radius: 18px;
          background: #fff;
          box-shadow: 4px 5px 0 rgba(87, 80, 146, .10);
        }

        .hrms-alumni-subtab-btn {
          min-height: 48px;
          padding: 10px 13px;
          border: 1px solid rgba(77, 119, 221, .18);
          border-radius: 14px;
          color: #4767b4;
          background: #f0f5ff;
          box-shadow: 3px 4px 0 rgba(87, 80, 146, .10);
        }

        .hrms-alumni-subtab-btn.active {
          border-color: transparent;
          color: #fff;
          background: linear-gradient(135deg, #4d77dd 0%, #2eb2b9 100%);
          box-shadow: 4px 5px 0 #575092;
        }

        .hrms-alumni-section {
          animation: hrmsEmployeeSectionReveal 220ms ease both;
        }

        .hrms-modal-backdrop {
          position: fixed;
          inset: 0;
          z-index: 980;
          padding: 18px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(16, 26, 58, .48);
          backdrop-filter: blur(7px);
          animation: hrmsEmployeeModalFade 180ms ease both;
        }

        .hrms-modal {
          width: min(1120px, calc(100vw - 36px));
          max-height: calc(100dvh - 36px);
          overflow-y: auto;
          overscroll-behavior: contain;
          padding: clamp(16px, 2vw, 22px);
          border: 1px solid rgba(255, 255, 255, .70);
          border-radius: 28px;
          background: #fff;
          box-shadow: 0 30px 80px rgba(16, 26, 58, .30);
          animation: hrmsEmployeeModalIn 230ms var(--emp-ease) both;
        }

        .hrms-modal.small {
          width: min(620px, calc(100vw - 36px));
          padding: clamp(22px, 3vw, 32px);
        }

        .hrms-modal.small > h3 {
          margin: 0;
          color: var(--emp-ink);
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(28px, 3vw, 40px);
          font-weight: 760;
          line-height: 1;
          letter-spacing: -.04em;
        }

        .hrms-modal.small > p {
          margin: 12px 0 0;
          color: var(--emp-soft);
          font-size: 12px;
          line-height: 1.6;
        }

        .hrms-modal-grid {
          margin-top: 20px;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }

        .hrms-modal-actions {
          margin-top: 18px;
        }

        @media (max-width: 1366px) {
          .hrms-stats-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .hrms-filter-grid {
            grid-template-columns:
              auto
              minmax(210px, 1.35fr)
              repeat(3, minmax(130px, .85fr));
          }

          .hrms-filter-grid > select:nth-of-type(4),
          .hrms-filter-grid > .hrms-secondary-btn {
            grid-column: span 1;
          }

          .hrms-form-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 1024px) {
          .hrms-hero {
            grid-template-columns: 1fr;
          }

          .hrms-hero-actions {
            justify-content: flex-start;
          }

          .hrms-action-stack {
            width: min(360px, 100%);
          }

          .hrms-tabs {
            grid-template-columns: 1fr;
          }

          .hrms-filter-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .hrms-filter-label {
            grid-column: 1 / -1;
          }

          .hrms-pagination {
            align-items: flex-start;
            flex-direction: column;
          }

          .hrms-pagination-controls {
            width: 100%;
            justify-content: flex-start;
          }
        }

        @media (max-width: 760px) {
          .hrms-employees-page {
            gap: 16px;
          }

          .hrms-hero {
            min-height: 0;
            padding: 20px;
            border-radius: 26px;
            box-shadow:
              6px 7px 0 #b9d7ff,
              0 18px 30px rgba(34, 38, 110, .10);
          }

          .hrms-hero h1 {
            font-size: clamp(36px, 10vw, 52px);
          }

          .hrms-stats-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .hrms-panel,
          .hrms-form-card {
            padding: 18px;
            border-radius: 22px;
            box-shadow:
              5px 6px 0 #c4ccff,
              0 17px 28px rgba(34, 38, 110, .09);
          }

          .hrms-section-heading {
            flex-direction: column;
          }

          .hrms-actions {
            width: 100%;
            justify-content: flex-start;
          }

          .hrms-filter-grid,
          .hrms-form-grid,
          .hrms-checkbox-grid,
          .hrms-modal-grid {
            grid-template-columns: 1fr;
          }

          .hrms-filter-label {
            grid-column: auto;
          }

          .hrms-filter-grid > * {
            grid-column: auto !important;
          }

          .hrms-pagination-controls {
            align-items: stretch;
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .hrms-page-size-control,
          .hrms-page-numbers,
          .hrms-page-indicator {
            grid-column: 1 / -1;
            justify-self: stretch;
          }

          .hrms-page-size-control {
            justify-content: space-between;
          }

          .hrms-page-size-control select {
            flex: 1 1 auto;
          }

          .hrms-page-numbers {
            justify-content: center;
            flex-wrap: wrap;
          }

          .hrms-page-indicator {
            text-align: center;
          }

          .hrms-page-button {
            width: 100%;
          }

          .hrms-alumni-subtabs {
            grid-template-columns: 1fr;
          }

          .hrms-table-wrap {
            overflow: visible;
            border: 0;
            border-radius: 0;
            background: transparent;
            cursor: default;
          }

          .hrms-table {
            min-width: 0;
            border-collapse: separate;
            border-spacing: 0 12px;
          }

          .hrms-table thead {
            display: none;
          }

          .hrms-table,
          .hrms-table tbody,
          .hrms-table tr,
          .hrms-table td {
            display: block;
            width: 100%;
          }

          .hrms-table tbody tr {
            overflow: hidden;
            border: 1px solid rgba(171, 181, 211, .58);
            border-radius: 18px;
            background: #fff;
            box-shadow:
              4px 5px 0 #c4ccff,
              0 14px 24px rgba(34, 38, 110, .07);
          }

          .hrms-table td {
            min-height: 46px;
            padding: 11px 13px 11px 42%;
            border-bottom: 1px solid rgba(171, 181, 211, .28);
            position: relative;
          }

          .hrms-table td::before {
            content: attr(data-label);
            position: absolute;
            top: 12px;
            left: 13px;
            width: 34%;
            color: #5d6785;
            font-size: 8px;
            font-weight: 950;
            letter-spacing: .08em;
            text-transform: uppercase;
          }

          .hrms-table td:last-child {
            border-bottom: 0;
          }

          .hrms-table-action {
            min-width: 0;
          }

          .hrms-person-cell {
            min-width: 0;
          }

          .hrms-row-actions {
            justify-content: flex-start;
          }

          .hrms-modal-backdrop {
            align-items: flex-end;
            padding: 0;
          }

          .hrms-modal,
          .hrms-modal.small {
            width: 100%;
            max-width: 100%;
            max-height: calc(100dvh - max(8px, env(safe-area-inset-top)));
            margin: 0;
            padding:
              16px
              max(16px, env(safe-area-inset-right))
              max(16px, env(safe-area-inset-bottom))
              max(16px, env(safe-area-inset-left));
            border-radius: 24px 24px 0 0;
            box-shadow: 0 -18px 60px rgba(34, 38, 110, .24);
          }
        }

        @media (max-width: 520px) {
          .hrms-hero {
            padding: 16px;
          }

          .hrms-hero h1 {
            font-size: clamp(32px, 11vw, 44px);
          }

          .hrms-stats-grid {
            grid-template-columns: 1fr;
          }

          .hrms-stat-card {
            min-height: 102px;
          }

          .hrms-panel,
          .hrms-form-card {
            padding: 15px;
          }

          .hrms-tabs {
            padding: 9px;
            border-radius: 18px;
          }

          .hrms-tab-btn {
            min-height: 58px;
            padding: 10px 11px;
          }

          .hrms-filter-grid {
            padding: 10px;
          }

          .hrms-actions,
          .hrms-row-actions,
          .hrms-form-actions,
          .hrms-modal-actions {
            width: 100%;
            display: grid;
            grid-template-columns: 1fr;
          }

          .hrms-actions button,
          .hrms-row-actions button,
          .hrms-form-actions button,
          .hrms-modal-actions button,
          .hrms-refresh-btn {
            width: 100%;
          }

          .hrms-table td {
            padding-left: 13px;
            padding-top: 30px;
          }

          .hrms-table td::before {
            top: 9px;
            width: calc(100% - 26px);
          }

          .hrms-page-number {
            width: 34px;
            height: 34px;
          }
        }

        @media (orientation: landscape) and (max-height: 600px) {
          .hrms-modal,
          .hrms-modal.small {
            max-height: calc(100dvh - 8px);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .hrms-employees-page *,
          .hrms-employees-page *::before,
          .hrms-employees-page *::after {
            animation: none !important;
            transition: none !important;
            scroll-behavior: auto !important;
          }
        }
      `}</style>

      <section className="hrms-hero">
        <div className="hrms-hero-content">
          <div>
            <span className="hrms-kicker">
              <Sparkles size={13} />
              HR Employee Management
            </span>

            <h1>
              People operations, <em>clearly organised.</em>
            </h1>

            <p>
              Manage active employees, create new employee records and maintain
              alumni separately, while preserving the existing employee,
              reporting, subscription and account workflows.
            </p>
          </div>

          <div className="hrms-hero-actions">
            <div className="hrms-action-stack">
              <button
                type="button"
                className="hrms-refresh-btn"
                onClick={() => reloadAll({ feedbackScope: 'refresh' })}
                disabled={loadingEmployees || loadingAlumni}
              >
                {loadingEmployees || loadingAlumni ? (
                  <Loader2 size={16} className="hrms-spin" />
                ) : (
                  <RefreshCw size={16} />
                )}
                {loadingEmployees || loadingAlumni
                  ? 'Refreshing...'
                  : 'Refresh Data'}
              </button>

              {message.scope === 'refresh' ? (
                <EmployeeInlineMessage
                  message={message}
                  onClose={clearMessage}
                />
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="hrms-stats-grid" aria-label="Employee summary">
        <div className="hrms-stat-card">
          <span>Active Employees</span>
          <strong>{employeeStats.active}</strong>
        </div>

        <div className="hrms-stat-card">
          <span>Departments</span>
          <strong>{employeeStats.departments}</strong>
        </div>

        <div className="hrms-stat-card">
          <span>Designations</span>
          <strong>{employeeStats.designations}</strong>
        </div>

        <div className="hrms-stat-card">
          <span>Alumni</span>
          <strong>{employeeStats.alumni}</strong>
        </div>
      </section>

      {hasFullTrialAccess ? (
        <div className="hrms-plan-alert success">
          <div>
            <strong>YourComate 15-Day Full Access Trial</strong>
            <div>
              All HRMS modules and employee management are available during the
              active trial.
            </div>
            <div>
              Trial end date: {formatSaasDate(getTrialEndDate(user))}. After
              expiry, subscription payment is required.
            </div>
          </div>

          <button
            type="button"
            className="hrms-primary-btn"
            onClick={openBillingPage}
          >
            View Plans
          </button>
        </div>
      ) : null}

      {hasPaidEmployeeLimit ? (
        <div
          className={`hrms-plan-alert ${
            isPaidEmployeeLimitReached ? 'error' : 'success'
          }`}
        >
          <div>
            <strong>YourComate {saasPlanName} Employee Limit</strong>
            <div>
              Employees used: {employeesUsedForLimit} / {saasEmployeeLimit}.{' '}
              {isPaidEmployeeLimitReached
                ? isPaidRenewalDueSoon
                  ? `${saasPlanName} employee limit reached. Renewal or plan-change controls are now available.`
                  : `${saasPlanName} employee limit reached. Contact Superadmin for an immediate plan revision.`
                : `${paidEmployeesRemaining} employee slot(s) remaining in this plan.`}
            </div>

            {!isPaidRenewalDueSoon ? (
              <div style={{ marginTop: 5 }}>
                Subscription active until{' '}
                {formatSaasDate(paidSubscriptionEndDate)}. Upgrade and renewal
                controls remain hidden until the final 7 days.
              </div>
            ) : null}
          </div>

          {isPaidRenewalDueSoon ? (
            <button
              type="button"
              className="hrms-primary-btn"
              onClick={openBillingPage}
            >
              Renew or Change Plan
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="hrms-section-tabs-holder">
        <nav className="hrms-tabs" aria-label="Employee management sections">
          <button
            type="button"
            className={`hrms-tab-btn ${
              activeTab === 'master' ? 'active' : ''
            }`}
            onClick={() => setActiveTab('master')}
            aria-pressed={activeTab === 'master'}
          >
            <Users size={18} />
            <span className="hrms-tab-copy">
              <strong>Employee Master</strong>
              <small>Search, filter, edit and manage active employees</small>
            </span>
            <span className="hrms-tab-count">{employees.length}</span>
          </button>

          <button
            type="button"
            className={`hrms-tab-btn ${
              activeTab === 'create' ? 'active' : ''
            }`}
            onClick={() => {
              if (isExpiredOrSuspendedTenant) {
                openBillingPage();
                return;
              }

              if (isPaidEmployeeLimitReached) {
                if (isPaidRenewalDueSoon) {
                  openBillingPage();
                } else {
                  showMessage(
                    'error',
                    `Your ${saasPlanName} employee limit has been reached. Contact Superadmin for an immediate plan revision.`,
                  );
                }
                return;
              }

              setActiveTab('create');
            }}
            aria-pressed={activeTab === 'create'}
          >
            <UserPlus size={18} />
            <span className="hrms-tab-copy">
              <strong>Create Employee</strong>
              <small>Add an active employee using the complete form</small>
            </span>
          </button>

          <button
            type="button"
            className={`hrms-tab-btn ${
              activeTab === 'alumni' ? 'active' : ''
            }`}
            onClick={() => setActiveTab('alumni')}
            aria-pressed={activeTab === 'alumni'}
          >
            <Archive size={18} />
            <span className="hrms-tab-copy">
              <strong>Alumni</strong>
              <small>Review past employees or add historical records</small>
            </span>
            <span className="hrms-tab-count">{alumni.length}</span>
          </button>
        </nav>
      </div>

      {message.scope === 'page' ? (
        <EmployeeInlineMessage message={message} onClose={clearMessage} />
      ) : null}

      {activeTab === 'master' ? (
        <section className="hrms-section-content hrms-panel">
          <div className="hrms-section-heading">
            <div>
              <span className="hrms-section-kicker">
                <BriefcaseBusiness size={12} />
                Active Workforce
              </span>
              <h3>Employee Master</h3>
              <p>
                Showing only active/current employees. Use Edit to update
                existing employee details or mark an employee as resigned.
              </p>
            </div>

            <div className="hrms-actions">
              <button
                type="button"
                className="hrms-secondary-btn"
                onClick={handleDownloadEmployeeExcel}
              >
                <Download size={15} />
                Download Active Excel
              </button>

              <button
                type="button"
                className="hrms-primary-btn"
                onClick={() => setActiveTab('create')}
              >
                <PlusCircle size={15} />
                Create Employee
              </button>

              {message.scope === 'master-actions' ? (
                <EmployeeInlineMessage
                  message={message}
                  onClose={clearMessage}
                />
              ) : null}
            </div>
          </div>

          <div className="hrms-filter-grid">
            <div className="hrms-filter-label">
              <Filter size={16} />
              <span>Filters</span>
            </div>

            <div className="hrms-search-wrap">
              <Search size={15} />
              <input
                name="q"
                type="search"
                value={filters.q}
                onChange={handleFilterChange}
                placeholder="Search employee, code, email..."
                aria-label="Search active employees"
              />
            </div>

            <select
              name="department"
              value={filters.department}
              onChange={handleFilterChange}
            >
              <option value="">All Departments</option>
              {employeeDepartments.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>

            <select
              name="designation"
              value={filters.designation}
              onChange={handleFilterChange}
            >
              <option value="">All Designations</option>
              {employeeDesignations.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>

            <select
              name="state"
              value={filters.state}
              onChange={handleFilterChange}
            >
              <option value="">All States</option>
              {employeeStates.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>

            <select
              name="employment_status"
              value={filters.employment_status}
              onChange={handleFilterChange}
            >
              <option value="">All Status</option>
              <option value="active">Active</option>
              <option value="probation">Probation</option>
              <option value="confirmed">Confirmed</option>
            </select>

            <button
              type="button"
              className="hrms-secondary-btn"
              onClick={resetFilters}
            >
              Reset
            </button>
          </div>

          <EmployeePagination
            total={filteredEmployees.length}
            page={Math.min(employeePage, employeePageCount)}
            pageSize={employeePageSize}
            onPageChange={setEmployeePage}
            onPageSizeChange={(value) => {
              setEmployeePage(1);
              setEmployeePageSize(value);
            }}
            label="active employees"
          />

          <EmployeeMasterTable
            rows={pagedEmployees}
            loading={loadingEmployees}
            onEdit={openEditModal}
            onResign={openResignModal}
          />
        </section>
      ) : null}

      {activeTab === 'create' ? (
        <section className="hrms-section-content">
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
            feedback={message.scope === 'create' ? message : null}
            onFeedbackClose={clearMessage}
          />
        </section>
      ) : null}

      {activeTab === 'alumni' ? (
        <section className="hrms-section-content hrms-alumni-layout">
          <nav
            className="hrms-alumni-subtabs"
            role="tablist"
            aria-label="Alumni sections"
          >
            <button
              type="button"
              className={`hrms-alumni-subtab-btn ${
                activeAlumniSection === 'employees' ? 'active' : ''
              }`}
              onClick={() => setActiveAlumniSection('employees')}
              aria-pressed={activeAlumniSection === 'employees'}
            >
              <History size={15} />
              Alumni Employees
            </button>

            <button
              type="button"
              className={`hrms-alumni-subtab-btn ${
                activeAlumniSection === 'add' ? 'active' : ''
              }`}
              onClick={() => setActiveAlumniSection('add')}
              aria-pressed={activeAlumniSection === 'add'}
            >
              <PlusCircle size={15} />
              Add Past Employee
            </button>
          </nav>

          {activeAlumniSection === 'employees' ? (
            <div className="hrms-panel hrms-alumni-section">
              <div className="hrms-section-heading">
                <div>
                  <span className="hrms-section-kicker">
                    <Archive size={12} />
                    Alumni Records
                  </span>
                  <h3>Alumni Employees</h3>
                  <p>
                    Employees who resigned, left, retired, or were manually
                    added as past employees are listed here.
                  </p>
                </div>

                <div className="hrms-actions">
                  <button
                    type="button"
                    className="hrms-secondary-btn"
                    onClick={handleDownloadAlumniCsv}
                  >
                    <Download size={15} />
                    Download Alumni CSV
                  </button>

                  {message.scope === 'alumni-actions' ? (
                    <EmployeeInlineMessage
                      message={message}
                      onClose={clearMessage}
                    />
                  ) : null}
                </div>
              </div>

              <div className="hrms-filter-grid">
                <div className="hrms-filter-label">
                  <Filter size={16} />
                  <span>Filters</span>
                </div>

                <div className="hrms-search-wrap">
                  <Search size={15} />
                  <input
                    name="q"
                    type="search"
                    value={alumniFilters.q}
                    onChange={handleAlumniFilterChange}
                    placeholder="Search alumni, code, email..."
                    aria-label="Search alumni employees"
                  />
                </div>

                <select
                  name="department"
                  value={alumniFilters.department}
                  onChange={handleAlumniFilterChange}
                >
                  <option value="">All Departments</option>
                  {alumniDepartments.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>

                <select
                  name="designation"
                  value={alumniFilters.designation}
                  onChange={handleAlumniFilterChange}
                >
                  <option value="">All Designations</option>
                  {alumniDesignations.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>

                <select
                  name="state"
                  value={alumniFilters.state}
                  onChange={handleAlumniFilterChange}
                >
                  <option value="">All States</option>
                  {alumniStates.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>

                <select
                  name="employment_status"
                  value={alumniFilters.employment_status}
                  onChange={handleAlumniFilterChange}
                >
                  <option value="">All Status</option>
                  <option value="Resigned">Resigned</option>
                  <option value="Terminated">Terminated</option>
                  <option value="Retired">Retired</option>
                  <option value="Left">Left</option>
                </select>

                <button
                  type="button"
                  className="hrms-secondary-btn"
                  onClick={resetAlumniFilters}
                >
                  Reset
                </button>
              </div>

              <EmployeePagination
                total={filteredAlumni.length}
                page={Math.min(alumniPage, alumniPageCount)}
                pageSize={alumniPageSize}
                onPageChange={setAlumniPage}
                onPageSizeChange={(value) => {
                  setAlumniPage(1);
                  setAlumniPageSize(value);
                }}
                label="alumni employees"
              />

              <AlumniTable
                rows={pagedAlumni}
                loading={loadingAlumni}
              />
            </div>
          ) : null}

          {activeAlumniSection === 'add' ? (
            <div className="hrms-alumni-section">
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
                feedback={message.scope === 'alumni-create' ? message : null}
                onFeedbackClose={clearMessage}
              />
            </div>
          ) : null}
        </section>
      ) : null}

      {editingEmployee
        ? createPortal(
            <div
              className="hrms-modal-backdrop"
              role="presentation"
              onMouseDown={(event) => {
                if (
                  event.target === event.currentTarget &&
                  !saving
                ) {
                  closeEditModal();
                }
              }}
            >
              <div
                className="hrms-modal"
                role="dialog"
                aria-modal="true"
                aria-label="Edit employee"
              >
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
                  feedback={message.scope === 'edit-modal' ? message : null}
                  onFeedbackClose={clearMessage}
                />
                <div className="hrms-modal-actions">
                  <button
                    type="button"
                    className="hrms-secondary-btn"
                    onClick={closeEditModal}
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {resignEmployee
        ? createPortal(
            <div
              className="hrms-modal-backdrop"
              role="presentation"
              onMouseDown={(event) => {
                if (
                  event.target === event.currentTarget &&
                  !saving
                ) {
                  closeResignModal();
                }
              }}
            >
              <form
                className="hrms-modal small"
                onSubmit={handleConfirmResignation}
                role="dialog"
                aria-modal="true"
                aria-labelledby="hrms-resign-dialog-title"
              >
                <h3 id="hrms-resign-dialog-title">Mark Employee as Resigned</h3>
                <p>
                  This will move{' '}
                  <strong>{resignEmployee.name || resignEmployee.employee_name}</strong>{' '}
                  from Employee Master to Alumni and deactivate the employee login.
                </p>
                <div className="hrms-modal-grid">
                  <TextInput
                    label="Last Working Date"
                    name="last_working_date"
                    value={resignForm.last_working_date}
                    onChange={handleResignChange}
                    type="date"
                    required
                  />
                  <SelectInput
                    label="Exit Type"
                    name="exit_type"
                    value={resignForm.exit_type}
                    onChange={handleResignChange}
                    options={EXIT_TYPE_OPTIONS}
                  />
                  <TextInput
                    label="Reason"
                    name="resignation_reason"
                    value={resignForm.resignation_reason}
                    onChange={handleResignChange}
                    placeholder="Reason for resignation"
                  />
                </div>
                <div className="hrms-modal-actions">
                  <button
                    type="button"
                    className="hrms-secondary-btn"
                    onClick={closeResignModal}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="hrms-primary-btn"
                    disabled={saving}
                  >
                    {saving ? (
                      <>
                        <Loader2 size={15} className="hrms-spin" />
                        Updating...
                      </>
                    ) : (
                      'Confirm Resignation'
                    )}
                  </button>

                  {message.scope === 'resign-modal' ? (
                    <EmployeeInlineMessage
                      message={message}
                      onClose={clearMessage}
                    />
                  ) : null}
                </div>
              </form>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}