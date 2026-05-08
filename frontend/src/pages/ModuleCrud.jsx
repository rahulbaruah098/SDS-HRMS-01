import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Save, X } from 'lucide-react';
import { api } from '../api/client';
import {
  allModules,
  templates,
  LEAVE_TYPES_FOR_EMPLOYEE,
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

const LEAVE_BALANCE_MANAGER_ROLES = new Set([
  'super_admin',
  'admin',
  'hr_admin',
  'hr_manager',
  'hr',
  'hr_executive',
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
  'cl_opening_balance',
  'cl_credited',
  'cl_used',
  'cl_available',
  'el_opening_balance',
  'el_credited',
  'el_used',
  'el_available',
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

function normalizeRole(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replaceAll('-', '_')
    .replaceAll(' ', '_');
}

function normalizeProjectStatus(value) {
  const status = String(value || '').trim().toLowerCase();

  if (['completed', 'complete', 'done', 'closed', 'inactive'].includes(status)) {
    return 'completed';
  }

  if (['on_hold', 'on-hold', 'hold'].includes(status)) {
    return 'on_hold';
  }

  if (['active', 'ongoing', 'in_progress', 'in-progress', 'open'].includes(status)) {
    return 'active';
  }

  return status || 'active';
}

function isActiveProject(project = {}) {
  return (
    normalizeProjectStatus(project.status) === 'active' &&
    project.is_deleted !== true
  );
}

function projectDisplayName(project = {}) {
  return (
    project.name ||
    project.project_name ||
    project.title ||
    project._id ||
    'Unnamed Project'
  );
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

function leaveLiveStatus(row = {}) {
  if (row.live_status || row.status_text || row.status_display) {
    return row.live_status || row.status_text || row.status_display;
  }

  const status = String(row.status || '').toLowerCase();
  const stage = String(row.approval_stage || '').toLowerCase();

  if (status === 'approved' || stage === 'approved') return 'Approved';
  if (status === 'rejected' || stage === 'rejected') return 'Rejected / Cancelled';
  if (stage === 'team_leader') return 'Pending with Team Leader';
  if (stage === 'reporting_officer') return 'Pending with Reporting Officer';
  if (stage === 'hr') return 'Pending with HR';

  return row.approval_stage_label || statusLabel(row.status);
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

function toNumber(value, fallback = 0) {
  const parsed = Number(value);

  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return parsed;
}

function getStoredUser() {
  const keys = [
    'sds_hrms_user',
    'user',
    'currentUser',
    'auth_user',
    'hrms_user',
  ];

  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);

      if (!raw) {
        continue;
      }

      const parsed = JSON.parse(raw);

      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch {
      // Ignore malformed storage values.
    }
  }

  return {};
}

function getCurrentUserRoles() {
  const user = getStoredUser();
  const roles = [];

  if (Array.isArray(user.roles)) {
    roles.push(...user.roles);
  }

  if (user.role) {
    roles.push(user.role);
  }

  if (user.user?.role) {
    roles.push(user.user.role);
  }

  if (Array.isArray(user.user?.roles)) {
    roles.push(...user.user.roles);
  }

  return new Set(
    roles
      .map((role) => normalizeRole(role))
      .filter(Boolean),
  );
}

function canManageLeaveBalances() {
  if (isSuperAdmin()) {
    return true;
  }

  const roles = getCurrentUserRoles();

  for (const role of LEAVE_BALANCE_MANAGER_ROLES) {
    if (roles.has(role)) {
      return true;
    }
  }

  return false;
}

function emptyLeaveBalanceForm(template = {}) {
  return {
    ...template,
    employee_id: '',
    employee_name: '',
    department: '',
    designation: '',
    cl_opening_balance: 0,
    cl_credited: 0,
    cl_used: 0,
    cl_available: 0,
    el_opening_balance: 0,
    el_credited: 0,
    el_used: 0,
    el_available: 0,
    status: 'active',
  };
}

function normalizeBalancePayload(payload) {
  const clOpening = toNumber(payload.cl_opening_balance, 0);
  const clCredited = toNumber(payload.cl_credited, 0);
  const clUsed = toNumber(payload.cl_used, 0);

  const elOpening = toNumber(payload.el_opening_balance, 0);
  const elCredited = toNumber(payload.el_credited, 0);
  const elUsed = toNumber(payload.el_used, 0);

  const clAvailable =
    payload.cl_available === '' || payload.cl_available === undefined || payload.cl_available === null
      ? Math.max(clOpening + clCredited - clUsed, 0)
      : toNumber(payload.cl_available, 0);

  const elAvailable =
    payload.el_available === '' || payload.el_available === undefined || payload.el_available === null
      ? Math.max(elOpening + elCredited - elUsed, 0)
      : toNumber(payload.el_available, 0);

  return {
    employee_id: payload.employee_id,
    cl_opening_balance: clOpening,
    cl_credited: clCredited,
    cl_used: clUsed,
    cl_available: clAvailable,
    el_opening_balance: elOpening,
    el_credited: elCredited,
    el_used: elUsed,
    el_available: elAvailable,
    status: payload.status || 'active',
  };
}

function groupLeaveBalanceRows(rows = []) {
  const map = new Map();

  rows.forEach((row) => {
    const employeeId = row.employee_id || row.employee || row.user_id || row._id;

    if (!employeeId) {
      return;
    }

    if (!map.has(employeeId)) {
      map.set(employeeId, {
        _id: employeeId,
        employee_id: employeeId,
        employee_name: row.employee_name || row.name || '—',
        department: row.department || '',
        designation: row.designation || '',
        status: row.status || 'active',
        cl_opening_balance: 0,
        cl_credited: 0,
        cl_used: 0,
        cl_available: 0,
        el_opening_balance: 0,
        el_credited: 0,
        el_used: 0,
        el_available: 0,
        raw_rows: [],
      });
    }

    const grouped = map.get(employeeId);
    const leaveType = String(row.leave_type || row.leave_type_label || '').toUpperCase();

    grouped.raw_rows.push(row);
    grouped.employee_name = row.employee_name || grouped.employee_name;
    grouped.department = row.department || grouped.department;
    grouped.designation = row.designation || grouped.designation;
    grouped.status = row.status || grouped.status;

    if (leaveType === 'CL' || leaveType.includes('CASUAL')) {
      grouped.cl_opening_balance = row.opening_balance ?? 0;
      grouped.cl_credited = row.credited ?? 0;
      grouped.cl_used = row.used ?? 0;
      grouped.cl_available = row.available ?? 0;
    }

    if (leaveType === 'EL' || leaveType.includes('EARNED')) {
      grouped.el_opening_balance = row.opening_balance ?? 0;
      grouped.el_credited = row.credited ?? 0;
      grouped.el_used = row.used ?? 0;
      grouped.el_available = row.available ?? 0;
    }
  });

  return Array.from(map.values()).sort((a, b) =>
    String(a.employee_name || '').localeCompare(String(b.employee_name || '')),
  );
}

export default function ModuleCrud({ collection }) {
  const moduleInfo = allModules.find((m) => m[0] === collection);
  const template = templates[collection] || { title: '', status: 'active' };

  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(
    collection === 'leave_balances' ? emptyLeaveBalanceForm(template) : { ...template },
  );
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
  const leaveBalanceAllowed = collection !== 'leave_balances' || canManageLeaveBalances();

  const displayRows = useMemo(() => {
    if (collection === 'leave_balances') {
      return groupLeaveBalanceRows(rows);
    }

    return rows;
  }, [collection, rows]);

  const activeProjectOptions = useMemo(
    () => projectOptions.filter((project) => isActiveProject(project)),
    [projectOptions],
  );

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
    const params = {
      status: 'active',
    };

    if (isSuperAdmin() && nextTenant.trim()) {
      params.tenant_id = nextTenant.trim();
    }

    const data = await api(`/projects${buildQuery(params)}`);
    const items = (data.items || []).filter((project) => isActiveProject(project));

    setProjectOptions(items);
    return items;
  }

  async function loadLeaveOptions() {
    try {
      const data = await api('/leave_requests/options');

      setTaskHandoverOptions(data.task_handover_options || []);
      setProjectOptions((data.projects || []).filter((project) => isActiveProject(project)));
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
    if (collection === 'leave_balances') {
      setForm(emptyLeaveBalanceForm(template));
      return;
    }

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

    if (collection === 'leave_balances' && !canManageLeaveBalances()) {
      setLoading(false);
      setMessage('Leave Balances can only be accessed by HR, Admin, and Super Admin.');
      return;
    }

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

    if (!leaveBalanceAllowed) {
      setMessage('Leave Balances can only be managed by HR, Admin, and Super Admin.');
      return;
    }

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

        if (!payload.employee_id) {
          setMessage('Please select an employee.');
          setSaving(false);
          return;
        }
      }

      if (collection === 'leave_requests') {
        await api('/leave_requests/apply', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      } else {
        await api(`/${collection}`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }

      resetForm();
      setMessage(
        collection === 'leave_balances'
          ? 'Casual Leave and Earned Leave balances saved successfully'
          : collection === 'leave_requests'
            ? 'Leave request submitted successfully'
            : 'Record created successfully',
      );
      await load();
      await reloadEmployeeHelpers();
    } catch (error) {
      setMessage(error.message || 'Unable to create record');
    } finally {
      setSaving(false);
    }
  }

  async function startEdit(row) {
    if (!leaveBalanceAllowed) {
      setMessage('Leave Balances can only be managed by HR, Admin, and Super Admin.');
      return;
    }

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
        editData.approval_stage_label = leaveLiveStatus(row);
      }

      if (collection === 'leave_balances') {
        const selectedEmployee = employeeOptions.find((emp) => emp._id === row.employee_id);

        editData._id = row.employee_id;
        editData.employee_id = row.employee_id;
        editData.employee_name = row.employee_name || selectedEmployee?.name || '';
        editData.department = row.department || selectedEmployee?.department || '';
        editData.designation = row.designation || selectedEmployee?.designation || '';
        editData.cl_opening_balance = row.cl_opening_balance ?? 0;
        editData.cl_credited = row.cl_credited ?? 0;
        editData.cl_used = row.cl_used ?? 0;
        editData.cl_available = row.cl_available ?? 0;
        editData.el_opening_balance = row.el_opening_balance ?? 0;
        editData.el_credited = row.el_credited ?? 0;
        editData.el_used = row.el_used ?? 0;
        editData.el_available = row.el_available ?? 0;
        editData.status = row.status || 'active';
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
      delete payload.raw_rows;

      if (collection === 'employees') {
        payload.role = 'Employee';
      }

      if (collection === 'leave_requests') {
        payload = normalizeLeavePayload(payload);
      }

      if (collection === 'leave_balances') {
        payload = normalizeBalancePayload(payload);
      }

      const updateId =
        collection === 'leave_balances'
          ? edit.employee_id
          : edit._id;

      await api(`/${collection}/${updateId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });

      setEdit(null);
      setMessage(
        collection === 'leave_balances'
          ? 'Casual Leave and Earned Leave balances updated successfully'
          : 'Record updated successfully',
      );
      await load();
      await reloadEmployeeHelpers();
    } catch (error) {
      setMessage(error.message || 'Unable to update record');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    if (!leaveBalanceAllowed) {
      setMessage('Leave Balances can only be managed by HR, Admin, and Super Admin.');
      return;
    }

    if (collection === 'leave_balances') {
      setMessage('Leave Balances should be updated instead of deleted.');
      return;
    }

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

    const nextState = {
      ...state,
      employee_id: employeeId,
      employee_name: selectedEmployee?.name || '',
      department: selectedEmployee?.department || '',
      designation: selectedEmployee?.designation || '',
      team_leader_id: selectedEmployee?.team_leader_id || '',
      team_leader_name: selectedEmployee?.team_leader_name || '',
      reporting_officer_id: selectedEmployee?.reporting_officer_id || '',
      reporting_officer_name: selectedEmployee?.reporting_officer_name || '',
    };

    if (collection === 'leave_balances') {
      const existingRows = groupLeaveBalanceRows(rows);
      const existing = existingRows.find((item) => item.employee_id === employeeId);

      if (existing) {
        nextState.cl_opening_balance = existing.cl_opening_balance ?? 0;
        nextState.cl_credited = existing.cl_credited ?? 0;
        nextState.cl_used = existing.cl_used ?? 0;
        nextState.cl_available = existing.cl_available ?? 0;
        nextState.el_opening_balance = existing.el_opening_balance ?? 0;
        nextState.el_credited = existing.el_credited ?? 0;
        nextState.el_used = existing.el_used ?? 0;
        nextState.el_available = existing.el_available ?? 0;
        nextState.status = existing.status || 'active';
      }
    }

    setState(nextState);
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
    const selectedProject = activeProjectOptions.find((project) => project._id === projectId);

    setState({
      ...state,
      project_handover_id: projectId,
      project_handover_name: selectedProject ? projectDisplayName(selectedProject) : '',
    });
  }

  function updateLeaveBalanceNumber(state, setState, key, value) {
    const nextState = {
      ...state,
      [key]: value,
    };

    if (
      ['cl_opening_balance', 'cl_credited', 'cl_used'].includes(key)
    ) {
      const opening = toNumber(
        key === 'cl_opening_balance' ? value : nextState.cl_opening_balance,
        0,
      );
      const credited = toNumber(
        key === 'cl_credited' ? value : nextState.cl_credited,
        0,
      );
      const used = toNumber(
        key === 'cl_used' ? value : nextState.cl_used,
        0,
      );

      nextState.cl_available = Math.max(opening + credited - used, 0);
    }

    if (
      ['el_opening_balance', 'el_credited', 'el_used'].includes(key)
    ) {
      const opening = toNumber(
        key === 'el_opening_balance' ? value : nextState.el_opening_balance,
        0,
      );
      const credited = toNumber(
        key === 'el_credited' ? value : nextState.el_credited,
        0,
      );
      const used = toNumber(
        key === 'el_used' ? value : nextState.el_used,
        0,
      );

      nextState.el_available = Math.max(opening + credited - used, 0);
    }

    setState(nextState);
  }

  function renderEmployeeSelect(state, setState, key, finalLabel) {
    return (
      <label key={key}>
        {finalLabel}
        <select
          value={state[key] ?? ''}
          onChange={(event) => applyEmployeeChange(state, setState, event.target.value)}
          disabled={collection === 'leave_balances' && Boolean(edit)}
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
          <option value="">Select active project</option>

          {activeProjectOptions.map((project) => (
            <option key={project._id} value={project._id}>
              {projectDisplayName(project)}
              {project.department ? ` — ${project.department}` : ''}
            </option>
          ))}
        </select>

        {!activeProjectOptions.length && (
          <small>No active project found. Completed projects are hidden from handover.</small>
        )}
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

    const leaveBalanceLabels = {
      cl_opening_balance: 'Casual Leave Opening Balance',
      cl_credited: 'Casual Leave Credited',
      cl_used: 'Casual Leave Used',
      cl_available: 'Casual Leave Available',
      el_opening_balance: 'Earned Leave Opening Balance',
      el_credited: 'Earned Leave Credited',
      el_used: 'Earned Leave Used',
      el_available: 'Earned Leave Available',
    };

    if (leaveBalanceLabels[key]) {
      labelText = leaveBalanceLabels[key];
    }

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
            value={key === 'approval_stage_label' ? leaveLiveStatus(state) : state[key] ?? ''}
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

    if (
      (collection === 'holiday_calendar' || collection === 'leave_balances') &&
      key === 'status'
    ) {
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

    if (collection === 'leave_balances' && key !== 'employee_id' && key !== 'status') {
      return (
        <label key={key}>
          {labelText}
          <input
            type="number"
            step="0.5"
            value={state[key] ?? 0}
            readOnly={key.endsWith('_available')}
            onChange={(event) =>
              updateLeaveBalanceNumber(state, setState, key, event.target.value)
            }
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
        'cl_opening_balance',
        'cl_credited',
        'cl_used',
        'cl_available',
        'el_opening_balance',
        'el_credited',
        'el_used',
        'el_available',
        'status',
      ];
    }

    return Object.keys(row || {})
      .filter((key) => !HIDDEN_TABLE_KEYS.has(key))
      .slice(0, 8);
  }

  function tableHeaderLabel(key) {
    const labels = {
      employee_name: 'Employee Name',
      cl_opening_balance: 'CL Opening',
      cl_credited: 'CL Credited',
      cl_used: 'CL Used',
      cl_available: 'CL Available',
      el_opening_balance: 'EL Opening',
      el_credited: 'EL Credited',
      el_used: 'EL Used',
      el_available: 'EL Available',
      approval_stage_label: 'Live Status',
    };

    return labels[key] || titleCase(key);
  }

  function tableCellValue(row, key) {
    if (key === 'leave_type') {
      return leaveTypeLabel(row.leave_type_label || row.leave_type);
    }

    if (key === 'approval_stage_label') {
      return leaveLiveStatus(row);
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

    if (collection === 'leave_balances') {
      return (
        <button
          type="button"
          className="secondary"
          onClick={() => startEdit(row)}
          disabled={saving}
        >
          Edit
        </button>
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

  if (!leaveBalanceAllowed) {
    return (
      <div className="page-grid">
        <section className="hero compact">
          <div>
            <span className="kicker">Restricted</span>
            <h1>Leave Balances</h1>
            <p>This page can only be viewed and used by HR, Admin, and Super Admin.</p>
          </div>
        </section>
      </div>
    );
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
              Upto Date, Task Handover To, and Project Handover. Only active
              projects are shown in the Project Handover dropdown.
            </p>
          )}

          {collection === 'leave_balances' && (
            <p>
              HR/Admin can assign Casual Leave and Earned Leave together from one
              form. Available balance is reflected in employee leave management
              and is deducted after final approval.
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
              <Plus size={16} /> {saving ? 'Saving...' : collection === 'leave_balances' ? 'Save Leave Balances' : 'Create'}
            </button>
          </form>
        )}

        {message && <div className="inline-message">{message}</div>}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {displayRows[0] &&
                  visibleTableKeys(displayRows[0]).map((key) => (
                    <th key={key}>{tableHeaderLabel(key)}</th>
                  ))}

                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {displayRows.map((row) => {
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

          {!displayRows.length && (
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

              {collection === 'leave_balances' && (
                <p>
                  Update Casual Leave and Earned Leave together for this employee.
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