import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Save, X } from 'lucide-react';
import { api } from '../api/client';
import {
  allModules,
  templates,
  LEAVE_TYPES_FOR_EMPLOYEE,
  LEAVE_BALANCE_TYPES,
} from '../data/modules';
import { isSuperAdmin } from '../utils/authHelpers';

const HOLIDAY_STATES = [
  'Assam(HO)',
  'Manipur',
  'Mizoram',
  'Arunachal Pradesh',
];

const SYSTEM_GENERATED_COLLECTIONS = new Set([
  'attendance_logs',
  'compoff_credits',
  'audit_logs',
]);

const EMPLOYEE_OPTION_COLLECTIONS = new Set([
  'employees',
  'leave_balances',
  'leave_requests',
  'attendance_mode_requests',
  'expenses',
  'performance_reviews',
]);

const DATE_FIELDS = new Set([
  'date',
  'from_date',
  'to_date',
  'upto_date',
  'claim_date',
  'earned_date',
  'valid_until',
  'joining_date',
  'date_of_birth',
  'previous_employment_tenure_end_date',
  'previous_employment_tenure_from_date',
]);

const NUMBER_FIELDS = new Set([
  'gross_salary',
  'salary',
  'number_of_children',
  'children_in_hostel',
  'opening_balance',
  'credited',
  'used',
  'available',
  'leave_days',
  'rating',
  'amount',
]);

const TEXTAREA_FIELDS = new Set([
  'address',
  'reason',
  'message',
  'comments',
  'decision_note',
  'field_location',
  'description',
  'summary',
]);

const HIDDEN_TABLE_KEYS = new Set([
  'password_hash',
  'password',
  'is_deleted',
  '__v',
]);

const SIMPLE_LEAVE_CREATE_FIELDS = [
  'leave_type',
  'reason',
  'from_date',
  'upto_date',
  'task_handover_to_id',
  'project_handover_id',
];

const SIMPLE_LEAVE_EDIT_FIELDS = [
  'leave_type',
  'reason',
  'from_date',
  'upto_date',
  'task_handover_to_id',
  'task_handover_to_name',
  'project_handover_id',
  'project_handover_name',
  'status',
  'approval_stage',
  'approval_stage_label',
];

const LEAVE_BALANCE_CREATE_FIELDS = [
  'employee_id',
  'leave_type',
  'opening_balance',
  'credited',
  'used',
  'available',
  'status',
];

const EMPLOYEE_READONLY_SNAPSHOT_FIELDS = new Set([
  'employee_name',
  'department',
  'designation',
  'team_leader_id',
  'team_leader_name',
  'reporting_officer_id',
  'reporting_officer_name',
]);

function titleCase(value = '') {
  return String(value)
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function displayValue(value) {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  if (Array.isArray(value)) {
    return value.length ? value.join(', ') : '—';
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  if (typeof value === 'object') {
    if (value.$date) {
      return value.$date;
    }

    if (
      Object.prototype.hasOwnProperty.call(value, 'latitude') &&
      Object.prototype.hasOwnProperty.call(value, 'longitude')
    ) {
      const accuracy = value.accuracy ? ` • ±${Math.round(value.accuracy)}m` : '';
      return `${value.latitude}, ${value.longitude}${accuracy}`;
    }

    return JSON.stringify(value);
  }

  return String(value);
}

function buildQuery(params = {}) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }

    query.append(key, value);
  });

  const queryString = query.toString();
  return queryString ? `?${queryString}` : '';
}

function statusLabel(value) {
  if (!value) return '—';

  return String(value)
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function leaveTypeLabel(value) {
  const normalized = String(value || '').trim().toUpperCase();

  if (normalized === 'CL' || normalized === 'CASUAL LEAVE') {
    return 'Casual Leave';
  }

  if (normalized === 'EL' || normalized === 'EARNED LEAVE') {
    return 'Earned Leave';
  }

  if (normalized === 'COMP-OFF' || normalized === 'COMPOFF') {
    return 'Comp-Off';
  }

  return value || '—';
}

function normalizeLeavePayload(payload) {
  const nextPayload = { ...payload };

  if (nextPayload.upto_date && !nextPayload.to_date) {
    nextPayload.to_date = nextPayload.upto_date;
  }

  if (nextPayload.to_date && !nextPayload.upto_date) {
    nextPayload.upto_date = nextPayload.to_date;
  }

  delete nextPayload.employee_id;
  delete nextPayload.employee_name;
  delete nextPayload.department;
  delete nextPayload.designation;
  delete nextPayload.team_leader_id;
  delete nextPayload.team_leader_name;
  delete nextPayload.reporting_officer_id;
  delete nextPayload.reporting_officer_name;
  delete nextPayload.status;
  delete nextPayload.approval_stage;
  delete nextPayload.approval_stage_label;
  delete nextPayload.approval_history;
  delete nextPayload.balance_deducted;
  delete nextPayload.leave_days;

  return nextPayload;
}

function normalizeBalancePayload(payload) {
  const nextPayload = { ...payload };
  const selected = LEAVE_BALANCE_TYPES.find((item) => item.value === nextPayload.leave_type);

  nextPayload.leave_type = nextPayload.leave_type || 'CL';
  nextPayload.leave_type_label = selected?.label || leaveTypeLabel(nextPayload.leave_type);

  return nextPayload;
}

export default function ModuleCrud({ collection }) {
  const moduleInfo = allModules.find((m) => m[0] === collection);
  const template = templates[collection] || { title: '', status: 'active' };

  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ ...template });
  const [edit, setEdit] = useState(null);
  const [q, setQ] = useState('');
  const [tenant, setTenant] = useState('');
  const [message, setMessage] = useState('');
  const [employeeOptions, setEmployeeOptions] = useState([]);
  const [designationOptions, setDesignationOptions] = useState([]);
  const [departmentOptions, setDepartmentOptions] = useState([]);
  const [projectOptions, setProjectOptions] = useState([]);
  const [taskHandoverOptions, setTaskHandoverOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const isSystemGenerated = SYSTEM_GENERATED_COLLECTIONS.has(collection);

  const createFields = useMemo(() => {
    if (collection === 'leave_requests') {
      return SIMPLE_LEAVE_CREATE_FIELDS;
    }

    if (collection === 'leave_balances') {
      return LEAVE_BALANCE_CREATE_FIELDS;
    }

    return Object.keys(template);
  }, [collection, template]);

  const editFields = useMemo(() => {
    if (collection === 'employees') {
      return Object.keys(template).filter(
        (key) => key !== 'password' && key !== 'password_mode',
      );
    }

    if (collection === 'leave_requests') {
      return SIMPLE_LEAVE_EDIT_FIELDS;
    }

    if (collection === 'leave_balances') {
      return LEAVE_BALANCE_CREATE_FIELDS;
    }

    return Object.keys(template);
  }, [collection, template]);

  function buildParams(nextQ = q, nextTenant = tenant) {
    const params = {};

    if (nextQ.trim()) {
      params.q = nextQ.trim();
    }

    if (isSuperAdmin() && nextTenant.trim()) {
      params.tenant_id = nextTenant.trim();
    }

    return params;
  }

  async function load(nextQ = q, nextTenant = tenant) {
    const data = await api(`/${collection}${buildQuery(buildParams(nextQ, nextTenant))}`);
    setRows(data.items || []);
    return data.items || [];
  }

  async function loadEmployeeOptions(nextTenant = tenant) {
    const params = {};

    if (isSuperAdmin() && nextTenant.trim()) {
      params.tenant_id = nextTenant.trim();
    }

    const data = await api(`/employees${buildQuery(params)}`);
    const items = data.items || [];

    setEmployeeOptions(items);
    return items;
  }

  async function loadDesignationOptions(nextTenant = tenant) {
    const params = {};

    if (isSuperAdmin() && nextTenant.trim()) {
      params.tenant_id = nextTenant.trim();
    }

    const data = await api(`/designations${buildQuery(params)}`);
    const items = data.items || [];

    setDesignationOptions(items);
    return items;
  }

  async function loadDepartmentOptions(nextTenant = tenant) {
    const params = {};

    if (isSuperAdmin() && nextTenant.trim()) {
      params.tenant_id = nextTenant.trim();
    }

    const data = await api(`/departments${buildQuery(params)}`);
    const items = data.items || [];

    setDepartmentOptions(items);
    return items;
  }

  async function loadProjectOptions(nextTenant = tenant) {
    const params = {};

    if (isSuperAdmin() && nextTenant.trim()) {
      params.tenant_id = nextTenant.trim();
    }

    const data = await api(`/projects${buildQuery(params)}`);
    const items = data.items || [];

    setProjectOptions(items);
    return items;
  }

  async function loadLeaveOptions() {
    try {
      const data = await api('/leave_requests/options');

      setTaskHandoverOptions(data.task_handover_options || []);
      setProjectOptions(data.projects || []);
    } catch (error) {
      console.warn('Unable to load leave options:', error);
      setTaskHandoverOptions([]);
      await loadProjectOptions();
    }
  }

  async function reloadEmployeeHelpers(nextTenant = tenant) {
    if (!EMPLOYEE_OPTION_COLLECTIONS.has(collection)) {
      if (collection === 'projects') {
        await loadProjectOptions(nextTenant);
      }

      return;
    }

    await loadEmployeeOptions(nextTenant);

    if (collection === 'employees') {
      await loadDesignationOptions(nextTenant);
      await loadDepartmentOptions(nextTenant);
    }

    if (collection === 'leave_requests') {
      await loadLeaveOptions();
    }
  }

  function resetForm() {
    setForm({ ...template });
  }

  function generatePassword() {
    const namePart = (form.name || form.email || 'User')
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 8);

    const pass = `${namePart || 'User'}@123`;

    setForm({
      ...form,
      password_mode: 'custom',
      password: pass,
    });
  }

  useEffect(() => {
    resetForm();
    setEdit(null);
    setMessage('');
    setRows([]);
    setEmployeeOptions([]);
    setDesignationOptions([]);
    setDepartmentOptions([]);
    setProjectOptions([]);
    setTaskHandoverOptions([]);

    setLoading(true);

    load('', '')
      .then(() => reloadEmployeeHelpers(''))
      .catch((error) => {
        console.error(error);
        setMessage(error.message || 'Unable to load records');
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection]);

  async function submit(event) {
    event.preventDefault();

    if (isSystemGenerated) {
      setMessage('This module is system generated. Use the dedicated workflow page.');
      return;
    }

    setMessage('');

    try {
      setSaving(true);

      let payload = { ...form };

      if (collection === 'employees') {
        delete payload.password_mode;
        payload.role = 'Employee';
      }

      if (collection === 'leave_requests') {
        payload = normalizeLeavePayload(payload);
      }

      if (collection === 'leave_balances') {
        payload = normalizeBalancePayload(payload);
      }

      await api(`/${collection}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      resetForm();
      setMessage('Record created successfully');
      await load();
      await reloadEmployeeHelpers();
    } catch (error) {
      setMessage(error.message || 'Unable to create record');
    } finally {
      setSaving(false);
    }
  }

  async function startEdit(row) {
    if (isSystemGenerated) {
      setMessage('This module is system generated and cannot be edited here.');
      return;
    }

    try {
      setMessage('');
      await reloadEmployeeHelpers();

      const editData = { ...template, ...row };

      if (collection === 'employees') {
        delete editData.password;
        delete editData.password_mode;

        editData.role = 'Employee';
        editData.is_team_leader = String(row.is_team_leader || 'false');
        editData.is_reporting_officer = String(row.is_reporting_officer || 'false');
        editData.team_leader_id = row.team_leader_id || '';
        editData.team_leader_name = row.team_leader_name || '';
        editData.reporting_officer_id = row.reporting_officer_id || '';
        editData.reporting_officer_name = row.reporting_officer_name || '';
      }

      if (collection === 'leave_requests') {
        editData.upto_date = row.upto_date || row.to_date || '';
        editData.task_handover_to_id = row.task_handover_to_id || '';
        editData.task_handover_to_name = row.task_handover_to_name || '';
        editData.project_handover_id = row.project_handover_id || '';
        editData.project_handover_name = row.project_handover_name || '';
      }

      if (collection === 'leave_balances') {
        editData.leave_type = row.leave_type || 'CL';
        editData.leave_type_label = row.leave_type_label || leaveTypeLabel(row.leave_type);
      }

      setEdit(editData);

      setTimeout(() => {
        document.getElementById('edit-section')?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      }, 100);
    } catch (error) {
      setMessage(error.message || 'Unable to open edit form');
    }
  }

  async function saveEdit(event) {
    event.preventDefault();
    setMessage('');

    try {
      setSaving(true);

      let payload = { ...edit };

      delete payload._id;
      delete payload.password_hash;
      delete payload.password_mode;
      delete payload.created_at;
      delete payload.updated_at;
      delete payload.created_by;
      delete payload.updated_by;

      if (collection === 'employees') {
        payload.role = 'Employee';
      }

      if (collection === 'leave_requests') {
        payload = normalizeLeavePayload(payload);
      }

      if (collection === 'leave_balances') {
        payload = normalizeBalancePayload(payload);
      }

      await api(`/${collection}/${edit._id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });

      setEdit(null);
      setMessage('Record updated successfully');
      await load();
      await reloadEmployeeHelpers();
    } catch (error) {
      setMessage(error.message || 'Unable to update record');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    if (isSystemGenerated) {
      setMessage('This module is system generated and cannot be deleted here.');
      return;
    }

    const ok = window.confirm('Are you sure you want to delete this record?');

    if (!ok) {
      return;
    }

    try {
      setMessage('');

      await api(`/${collection}/${id}`, {
        method: 'DELETE',
      });

      setMessage('Record deleted successfully');
      await load();
      await reloadEmployeeHelpers();
    } catch (error) {
      setMessage(error.message || 'Unable to delete record');
    }
  }

  async function runPayroll() {
    try {
      setMessage('');

      const month = form.month || new Date().toISOString().slice(0, 7);

      const data = await api('/payroll/run', {
        method: 'POST',
        body: JSON.stringify({ month }),
      });

      setMessage(data.message || 'Payroll processed');
      await load();
    } catch (error) {
      setMessage(error.message || 'Unable to run payroll');
    }
  }

  async function decideLeave(row, status) {
    const ok = window.confirm(`${statusLabel(status)} this leave request?`);

    if (!ok) {
      return;
    }

    try {
      setMessage('');
      setSaving(true);

      const data = await api(`/leave_requests/${row._id}/decision`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });

      setMessage(data.message || `Leave ${status}`);
      await load();
    } catch (error) {
      setMessage(error.message || 'Unable to update leave request');
    } finally {
      setSaving(false);
    }
  }

  async function decideModeRequest(row, status) {
    const ok = window.confirm(`${statusLabel(status)} this WFH / Field request?`);

    if (!ok) {
      return;
    }

    try {
      setMessage('');
      setSaving(true);

      const data = await api(`/attendance/mode-requests/${row._id}/decision`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });

      setMessage(data.message || `Request ${status}`);
      await load();
    } catch (error) {
      setMessage(error.message || 'Unable to update WFH / Field request');
    } finally {
      setSaving(false);
    }
  }

  async function searchRecords() {
    try {
      setMessage('');
      setLoading(true);

      await load(q, tenant);
      await reloadEmployeeHelpers(tenant);
    } catch (error) {
      setMessage(error.message || 'Unable to search records');
    } finally {
      setLoading(false);
    }
  }

  async function clearSearch() {
    const clearedQ = '';
    const clearedTenant = '';

    setQ(clearedQ);
    setTenant(clearedTenant);
    setMessage('');

    try {
      setLoading(true);
      await load(clearedQ, clearedTenant);
      await reloadEmployeeHelpers(clearedTenant);
    } catch (error) {
      setMessage(error.message || 'Unable to clear search');
    } finally {
      setLoading(false);
    }
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

  function applyEmployeeChange(state, setState, employeeId) {
    const selectedEmployee = employeeOptions.find((emp) => emp._id === employeeId);

    setState({
      ...state,
      employee_id: employeeId,
      employee_name: selectedEmployee?.name || '',
      department: selectedEmployee?.department || '',
      designation: selectedEmployee?.designation || '',
      team_leader_id: selectedEmployee?.team_leader_id || '',
      team_leader_name: selectedEmployee?.team_leader_name || '',
      reporting_officer_id: selectedEmployee?.reporting_officer_id || '',
      reporting_officer_name: selectedEmployee?.reporting_officer_name || '',
    });
  }

  function applyTaskHandoverChange(state, setState, employeeId) {
    const selectedEmployee =
      taskHandoverOptions.find((emp) => emp._id === employeeId) ||
      employeeOptions.find((emp) => emp._id === employeeId);

    setState({
      ...state,
      task_handover_to_id: employeeId,
      task_handover_to_name: selectedEmployee?.name || '',
      task_handover_employee_id:
        selectedEmployee?.employee_id || selectedEmployee?.emp_code || '',
    });
  }

  function applyProjectHandoverChange(state, setState, projectId) {
    const selectedProject = projectOptions.find((project) => project._id === projectId);

    setState({
      ...state,
      project_handover_id: projectId,
      project_handover_name: selectedProject?.name || '',
    });
  }

  function renderEmployeeSelect(state, setState, key, finalLabel) {
    return (
      <label key={key}>
        {finalLabel}
        <select
          value={state[key] ?? ''}
          onChange={(event) => applyEmployeeChange(state, setState, event.target.value)}
        >
          <option value="">Select employee</option>

          {employeeOptions.map((employee) => (
            <option key={employee._id} value={employee._id}>
              {employee.name} — {employee.employee_id || employee.emp_code || employee.designation || employee.department || employee.email}
            </option>
          ))}
        </select>
      </label>
    );
  }

  function renderTaskHandoverSelect(state, setState, key, finalLabel) {
    return (
      <label key={key}>
        {finalLabel}
        <select
          value={state[key] ?? ''}
          onChange={(event) =>
            applyTaskHandoverChange(state, setState, event.target.value)
          }
        >
          <option value="">Select department member</option>

          {taskHandoverOptions.map((employee) => (
            <option key={employee._id} value={employee._id}>
              {employee.name} — {employee.employee_id || employee.emp_code || employee.designation || employee.department || employee.email}
            </option>
          ))}
        </select>
      </label>
    );
  }

  function renderProjectHandoverSelect(state, setState, key, finalLabel) {
    return (
      <label key={key}>
        {finalLabel}
        <select
          value={state[key] ?? ''}
          onChange={(event) =>
            applyProjectHandoverChange(state, setState, event.target.value)
          }
        >
          <option value="">Select project</option>

          {projectOptions.map((project) => (
            <option key={project._id} value={project._id}>
              {project.name || project.title || project._id}
            </option>
          ))}
        </select>
      </label>
    );
  }

  function renderField(state, setState, key, isEditMode = false) {
    const label = key.replaceAll('_', ' ');

    const requiredFields = [
      'name',
      'email',
      'phone',
      'country',
      'joining_date',
      'gross_salary',
      'branch',
      'are_parents_senior_citizen',
      'payment_mode',
      'password',
      'role',
      'designation',
      'department',
      'shift',
      'gender',
      'disability_level',
      'employee_id',
      'leave_type',
      'date',
      'title',
      'state',
      'mode',
      'reason',
      'from_date',
      'to_date',
      'upto_date',
      'task_handover_to_id',
      'project_handover_id',
    ];

    let labelText = titleCase(label);

    if (key === 'upto_date') {
      labelText = 'Upto Date';
    }

    if (key === 'task_handover_to_id') {
      labelText = 'Task Handover To';
    }

    if (key === 'project_handover_id') {
      labelText = 'Project Handover';
    }

    const finalLabel =
      (
        collection === 'employees' ||
        collection === 'holiday_calendar' ||
        collection === 'leave_balances' ||
        collection === 'attendance_mode_requests' ||
        collection === 'leave_requests'
      ) &&
      requiredFields.includes(key)
        ? `${labelText} *`
        : labelText;

    if (collection === 'employees' && isEditMode && key === 'password') {
      return null;
    }

    if (collection === 'employees' && isEditMode && key === 'password_mode') {
      return null;
    }

    if (collection === 'leave_requests' && key === 'task_handover_to_id') {
      return renderTaskHandoverSelect(state, setState, key, finalLabel);
    }

    if (collection === 'leave_requests' && key === 'project_handover_id') {
      return renderProjectHandoverSelect(state, setState, key, finalLabel);
    }

    if (
      collection === 'leave_requests' &&
      ['task_handover_to_name', 'project_handover_name', 'approval_stage', 'approval_stage_label'].includes(key)
    ) {
      return (
        <label key={key}>
          {finalLabel}
          <input
            type="text"
            value={state[key] ?? ''}
            readOnly
            placeholder={labelText}
          />
        </label>
      );
    }

    if (
      [
        'leave_balances',
        'attendance_mode_requests',
        'expenses',
        'performance_reviews',
      ].includes(collection) &&
      key === 'employee_id'
    ) {
      return renderEmployeeSelect(state, setState, key, finalLabel);
    }

    if (
      ['employee_name', 'team_leader_name', 'reporting_officer_name'].includes(key) &&
      [
        'leave_balances',
        'attendance_mode_requests',
        'expenses',
        'performance_reviews',
      ].includes(collection)
    ) {
      return (
        <label key={key}>
          {finalLabel}
          <input
            type="text"
            value={state[key] ?? ''}
            readOnly
            placeholder={labelText}
          />
        </label>
      );
    }

    if (
      EMPLOYEE_READONLY_SNAPSHOT_FIELDS.has(key) &&
      [
        'leave_balances',
        'attendance_mode_requests',
        'expenses',
        'performance_reviews',
      ].includes(collection)
    ) {
      return (
        <label key={key}>
          {finalLabel}
          <input
            type="text"
            value={state[key] ?? ''}
            readOnly
            placeholder={labelText}
          />
        </label>
      );
    }

    if (collection === 'holiday_calendar' && key === 'state') {
      return (
        <label key={key}>
          {finalLabel}
          <select
            value={state[key] ?? 'Assam(HO)'}
            onChange={(event) => setState({ ...state, [key]: event.target.value })}
          >
            {HOLIDAY_STATES.map((holidayState) => (
              <option key={holidayState} value={holidayState}>
                {holidayState}
              </option>
            ))}
          </select>
        </label>
      );
    }

    if (collection === 'leave_balances' && key === 'leave_type') {
      return (
        <label key={key}>
          {finalLabel}
          <select
            value={state[key] ?? 'CL'}
            onChange={(event) => {
              const selected = LEAVE_BALANCE_TYPES.find(
                (item) => item.value === event.target.value,
              );

              setState({
                ...state,
                leave_type: event.target.value,
                leave_type_label: selected?.label || leaveTypeLabel(event.target.value),
              });
            }}
          >
            {LEAVE_BALANCE_TYPES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      );
    }

    if (collection === 'leave_requests' && key === 'leave_type') {
      return (
        <label key={key}>
          {finalLabel}
          <select
            value={state[key] ?? 'CL'}
            onChange={(event) => {
              const selected = LEAVE_TYPES_FOR_EMPLOYEE.find(
                (item) => item.value === event.target.value,
              );

              setState({
                ...state,
                leave_type: event.target.value,
                leave_type_label: selected?.label || leaveTypeLabel(event.target.value),
              });
            }}
          >
            {LEAVE_TYPES_FOR_EMPLOYEE.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      );
    }

    if (collection === 'attendance_mode_requests' && key === 'mode') {
      return (
        <label key={key}>
          {finalLabel}
          <select
            value={state[key] ?? 'wfh'}
            onChange={(event) => setState({ ...state, [key]: event.target.value })}
          >
            <option value="wfh">Work From Home</option>
            <option value="field">Field</option>
          </select>
        </label>
      );
    }

    if (
      ['leave_requests', 'attendance_mode_requests'].includes(collection) &&
      key === 'status'
    ) {
      return (
        <label key={key}>
          {finalLabel}
          <select
            value={state[key] ?? 'pending'}
            onChange={(event) => setState({ ...state, [key]: event.target.value })}
            disabled={collection === 'leave_requests'}
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="in_review">In Review</option>
          </select>
        </label>
      );
    }

    if (collection === 'holiday_calendar' && key === 'status') {
      return (
        <label key={key}>
          {finalLabel}
          <select
            value={state[key] ?? 'active'}
            onChange={(event) => setState({ ...state, [key]: event.target.value })}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
      );
    }

    if (collection === 'employees' && key === 'department') {
      return (
        <label key={key}>
          {finalLabel}
          <select
            value={state[key] ?? ''}
            onChange={(event) => setState({ ...state, [key]: event.target.value })}
          >
            <option value="">Select department</option>

            {departmentOptions.map((department) => {
              const value = department.name || department.title || '';

              if (!value) {
                return null;
              }

              return (
                <option key={department._id || value} value={value}>
                  {value}
                </option>
              );
            })}
          </select>
        </label>
      );
    }

    if (collection === 'employees' && key === 'designation') {
      return (
        <label key={key}>
          {finalLabel}
          <select
            value={state[key] ?? ''}
            onChange={(event) =>
              setState({ ...state, designation: event.target.value })
            }
          >
            <option value="">Select designation</option>

            {designationOptions.map((designation) => {
              const value = designation.title || designation.name || '';

              if (!value) {
                return null;
              }

              return (
                <option key={designation._id || value} value={value}>
                  {value}
                </option>
              );
            })}
          </select>
        </label>
      );
    }

    if (collection === 'employees' && key === 'password_mode') {
      return (
        <label key={key}>
          Password Type
          <select
            value={state[key] ?? 'default'}
            onChange={(event) => {
              const mode = event.target.value;

              setState({
                ...state,
                password_mode: mode,
                password: mode === 'default' ? '12345678' : '',
              });
            }}
          >
            <option value="default">Default Password (12345678)</option>
            <option value="custom">Custom Password</option>
          </select>
        </label>
      );
    }

    if (collection === 'employees' && ['state', 'branch'].includes(key)) {
      return (
        <label key={key}>
          {finalLabel}
          <select
            value={state[key] ?? 'Assam(HO)'}
            onChange={(event) => setState({ ...state, [key]: event.target.value })}
          >
            {HOLIDAY_STATES.map((holidayState) => (
              <option key={holidayState} value={holidayState}>
                {holidayState}
              </option>
            ))}
          </select>
        </label>
      );
    }

    if (collection === 'employees' && key === 'are_parents_senior_citizen') {
      return (
        <label key={key}>
          {finalLabel}
          <select
            value={String(state[key] ?? 'false')}
            onChange={(event) => setState({ ...state, [key]: event.target.value })}
          >
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </label>
      );
    }

    if (collection === 'employees' && key === 'role') {
      return (
        <label key={key}>
          Role *
          <select
            value="Employee"
            onChange={() => setState({ ...state, role: 'Employee' })}
          >
            <option value="Employee">Employee</option>
          </select>
          <small>
            Team Leader and Reporting Officer are selected below as employee
            capabilities, not separate login roles.
          </small>
        </label>
      );
    }

    if (['is_team_leader', 'is_reporting_officer'].includes(key)) {
      return (
        <label key={key}>
          {finalLabel}
          <select
            value={String(state[key] ?? 'false')}
            onChange={(event) => setState({ ...state, [key]: event.target.value })}
          >
            <option value="false">No</option>
            <option value="true">Yes</option>
          </select>
        </label>
      );
    }

    if (collection === 'employees' && ['team_leader_id', 'reporting_officer_id'].includes(key)) {
      const filteredEmployees = employeeOptions.filter(
        (employee) => employee._id !== state._id,
      );

      return (
        <label key={key}>
          {finalLabel}
          <select
            value={state[key] ?? ''}
            onChange={(event) => {
              if (key === 'team_leader_id') {
                applyTeamLeaderChange(state, setState, event.target.value);
                return;
              }

              applyReportingOfficerChange(state, setState, event.target.value);
            }}
          >
            <option value="">Select {label}</option>

            {filteredEmployees.map((employee) => (
              <option key={employee._id} value={employee._id}>
                {employee.name} — {employee.employee_id || employee.emp_code || employee.designation || employee.department || employee.email}
              </option>
            ))}
          </select>
        </label>
      );
    }

    if (
      collection === 'employees' &&
      ['team_leader_name', 'reporting_officer_name'].includes(key)
    ) {
      return (
        <label key={key}>
          {finalLabel}
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

    const selectOptions = {
      country: ['India', 'Bangladesh'],
      blood_group: ['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
      employee_type: ['', 'Permanent', 'Contractual', 'Intern', 'Consultant'],
      skill_level: ['', 'Skilled', 'Semi Skilled', 'Unskilled', 'Highly Skilled'],
      payment_mode: ['Bank Transfer', 'Cash', 'UPI', 'Cheque'],
      shift: ['General', 'Morning', 'Evening', 'Night'],
      gender: ['Male', 'Female', 'Other'],
      religion: ['', 'Hindu', 'Muslim', 'Christian', 'Sikh', 'Buddhist', 'Jain', 'Other'],
      marital_status: ['', 'Single', 'Married', 'Divorced', 'Widowed'],
      disability_level: ['No Disability', 'Mild', 'Moderate', 'Severe'],
      dependent_disability_level: ['No Disability', 'Mild', 'Moderate', 'Severe'],
      employment_status: ['', 'Active', 'Probation', 'Confirmed', 'Resigned', 'Terminated'],
      status: ['active', 'inactive', 'pending', 'approved', 'rejected'],
    };

    if (collection === 'employees' && selectOptions[key]) {
      return (
        <label key={key}>
          {finalLabel}
          <select
            value={state[key] ?? ''}
            onChange={(event) => setState({ ...state, [key]: event.target.value })}
          >
            {selectOptions[key].map((option) => (
              <option key={option || 'empty'} value={option}>
                {option || 'Choose One'}
              </option>
            ))}
          </select>
        </label>
      );
    }

    if (DATE_FIELDS.has(key)) {
      return (
        <label key={key}>
          {finalLabel}
          <input
            type="date"
            value={state[key] ?? ''}
            onChange={(event) => {
              const nextState = { ...state, [key]: event.target.value };

              if (collection === 'leave_requests' && key === 'upto_date') {
                nextState.to_date = event.target.value;
              }

              if (collection === 'leave_requests' && key === 'to_date') {
                nextState.upto_date = event.target.value;
              }

              setState(nextState);
            }}
          />
        </label>
      );
    }

    if (NUMBER_FIELDS.has(key)) {
      return (
        <label key={key}>
          {finalLabel}
          <input
            type="number"
            step={
              ['opening_balance', 'credited', 'used', 'available', 'leave_days'].includes(key)
                ? '0.5'
                : 'any'
            }
            value={state[key] ?? ''}
            onChange={(event) => setState({ ...state, [key]: event.target.value })}
          />
        </label>
      );
    }

    if (TEXTAREA_FIELDS.has(key)) {
      return (
        <label key={key}>
          {finalLabel}
          <textarea
            value={state[key] ?? ''}
            onChange={(event) => setState({ ...state, [key]: event.target.value })}
            rows={3}
            placeholder={labelText}
          />
        </label>
      );
    }

    return (
      <label key={key}>
        {finalLabel}
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
          onChange={(event) => setState({ ...state, [key]: event.target.value })}
        />
      </label>
    );
  }

  function visibleTableKeys(row) {
    if (collection === 'leave_requests') {
      return [
        'employee_name',
        'leave_type',
        'from_date',
        'to_date',
        'task_handover_to_name',
        'project_handover_name',
        'approval_stage_label',
        'status',
      ];
    }

    if (collection === 'leave_balances') {
      return [
        'employee_name',
        'leave_type',
        'opening_balance',
        'credited',
        'used',
        'available',
        'status',
      ];
    }

    return Object.keys(row || {})
      .filter((key) => !HIDDEN_TABLE_KEYS.has(key))
      .slice(0, 8);
  }

  function tableCellValue(row, key) {
    if (key === 'leave_type') {
      return leaveTypeLabel(row.leave_type_label || row.leave_type);
    }

    if (key === 'approval_stage_label') {
      return row.approval_stage_label || statusLabel(row.approval_stage);
    }

    if (key === 'status') {
      return statusLabel(row.status);
    }

    return displayValue(row[key]);
  }

  function renderRowActions(row) {
    if (collection === 'leave_requests' && row.status === 'pending') {
      return (
        <>
          <button
            type="button"
            className="secondary"
            onClick={() => decideLeave(row, 'approved')}
            disabled={saving}
          >
            Approve
          </button>

          <button
            type="button"
            className="danger"
            onClick={() => decideLeave(row, 'rejected')}
            disabled={saving}
          >
            Reject
          </button>
        </>
      );
    }

    if (collection === 'attendance_mode_requests' && row.status === 'pending') {
      return (
        <>
          <button
            type="button"
            className="secondary"
            onClick={() => decideModeRequest(row, 'approved')}
            disabled={saving}
          >
            Approve
          </button>

          <button
            type="button"
            className="danger"
            onClick={() => decideModeRequest(row, 'rejected')}
            disabled={saving}
          >
            Reject
          </button>
        </>
      );
    }

    if (collection !== 'audit_logs' && !isSystemGenerated) {
      return (
        <>
          <button
            type="button"
            className="secondary"
            onClick={() => startEdit(row)}
            disabled={saving}
          >
            Edit
          </button>

          <button
            type="button"
            className="danger"
            onClick={() => remove(row._id)}
            disabled={saving}
          >
            Delete
          </button>
        </>
      );
    }

    if (isSystemGenerated) {
      return <span>View only</span>;
    }

    return '—';
  }

  return (
    <div className="page-grid">
      <section className="hero compact">
        <div>
          <span className="kicker">Module</span>
          <h1>{moduleInfo?.[1] || collection}</h1>
          <p>{moduleInfo?.[3]}</p>

          {collection === 'employees' && (
            <p>
              Create every staff member as an Employee. Mark Team Leader or
              Reporting Officer only through capability mapping.
            </p>
          )}

          {collection === 'leave_requests' && (
            <p>
              Leave apply form is simplified to Leave Type, Reason, From Date,
              Upto Date, Task Handover To, and Project Handover.
            </p>
          )}
        </div>

        {collection === 'payroll_runs' && (
          <button type="button" className="primary" onClick={runPayroll}>
            Run Payroll
          </button>
        )}
      </section>

      <section className="panel">
        <div className="toolbar">
          <div className="search">
            <Search size={16} />

            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Search records..."
            />

            {isSuperAdmin() && (
              <input
                value={tenant}
                onChange={(event) => setTenant(event.target.value)}
                placeholder="tenant_id filter"
              />
            )}

            <button type="button" onClick={searchRecords} disabled={loading}>
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

        {isSystemGenerated && (
          <div className="inline-message">
            This module is system generated. Records can be viewed here, but
            creation and editing must happen through the dedicated attendance or
            workflow pages.
          </div>
        )}

        {collection !== 'audit_logs' && !isSystemGenerated && (
          <form className="dynamic-form" onSubmit={submit}>
            {createFields.map((key) => renderField(form, setForm, key, false))}

            {collection === 'employees' && (
              <button
                type="button"
                className="secondary"
                onClick={generatePassword}
                disabled={saving}
              >
                Auto Generate Password
              </button>
            )}

            <button type="submit" className="primary" disabled={saving}>
              <Plus size={16} /> {saving ? 'Creating...' : 'Create'}
            </button>
          </form>
        )}

        {message && <div className="inline-message">{message}</div>}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {rows[0] &&
                  visibleTableKeys(rows[0]).map((key) => (
                    <th key={key}>{titleCase(key)}</th>
                  ))}

                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((row) => {
                const keys = visibleTableKeys(row);

                return (
                  <tr key={row._id}>
                    {keys.map((key) => (
                      <td key={key}>{tableCellValue(row, key)}</td>
                    ))}

                    <td>{renderRowActions(row)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {!rows.length && (
            <div className="empty">
              {loading ? 'Loading records...' : 'No records found'}
            </div>
          )}
        </div>
      </section>

      {edit && (
        <section className="panel" id="edit-section">
          <div className="toolbar">
            <div>
              <h3>Edit {moduleInfo?.[1] || collection}</h3>

              {collection === 'employees' && (
                <p>
                  HR/Admin/Super Admin can change employee details, Team Leader
                  mapping, and Reporting Officer mapping from here.
                </p>
              )}

              {collection === 'leave_requests' && (
                <p>
                  Leave approval should be handled using Approve/Reject actions.
                  Form edit is kept only for correction of basic leave details.
                </p>
              )}
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

          <form className="dynamic-form" onSubmit={saveEdit}>
            {editFields.map((key) => renderField(edit, setEdit, key, true))}

            <button type="submit" className="primary" disabled={saving}>
              <Save size={16} /> {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}