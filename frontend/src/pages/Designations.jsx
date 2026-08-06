import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BadgeCheck,
  BriefcaseBusiness,
  Building2,
  ChevronLeft,
  ChevronRight,
  CircleOff,
  Edit3,
  Layers3,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UserRoundCog,
  X,
} from 'lucide-react';

import {
  createCollectionItem,
  deleteCollectionItem,
  getDepartments,
  listCollection,
  updateCollectionItem,
} from '../api/client';

const PAGE_SIZE = 100;

const EMPTY_FORM = {
  name: '',
  title: '',
  department: '',
  status: 'active',
};

function safeText(value = '') {
  return String(value ?? '').trim();
}

function designationName(row = {}) {
  return (
    safeText(row.name) ||
    safeText(row.designation_name) ||
    safeText(row.title) ||
    'Unnamed Designation'
  );
}

function designationTitle(row = {}) {
  const title = safeText(row.title);

  if (!title || title.toLowerCase() === designationName(row).toLowerCase()) {
    return '';
  }

  return title;
}

function designationDepartment(row = {}) {
  return (
    safeText(row.department) ||
    safeText(row.department_name) ||
    'All / Not mapped'
  );
}

function statusValue(row = {}) {
  const status = safeText(row.status).toLowerCase();
  return status || 'active';
}

function statusLabel(value = '') {
  return safeText(value).toLowerCase() === 'inactive' ? 'Inactive' : 'Active';
}

function recordId(row = {}) {
  return safeText(row.id || row._id);
}

function parseDate(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'object' && value.$date) {
    return parseDate(value.$date);
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTime(value) {
  const date = parseDate(value);

  if (!date) {
    return 'Not recorded';
  }

  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

function departmentOptionLabel(row = {}) {
  return (
    safeText(row.label) ||
    safeText(row.name) ||
    safeText(row.department_name) ||
    'Department'
  );
}

function DesignationFormModal({
  open,
  editing,
  form,
  departments,
  saving,
  error,
  onChange,
  onClose,
  onSubmit,
}) {
  if (!open) {
    return null;
  }

  return (
    <div
      className="designation-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) {
          onClose();
        }
      }}
    >
      <section
        className="designation-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="designation-form-title"
      >
        <header className="designation-modal-header">
          <div>
            <span className="designation-eyebrow">
              <BriefcaseBusiness size={16} />
              Designation master
            </span>

            <h2 id="designation-form-title">
              {editing ? 'Edit Designation' : 'Create Designation'}
            </h2>

            <p>
              {editing
                ? 'Update the designation identity, department mapping or status.'
                : 'Create a designation for employee records, reporting hierarchy and organisational filtering.'}
            </p>
          </div>

          <button
            type="button"
            className="designation-icon-button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close designation form"
          >
            <X size={20} />
          </button>
        </header>

        <form className="designation-form" onSubmit={onSubmit}>
          <div className="designation-form-grid">
            <div className="designation-field designation-field-full">
              <label htmlFor="designation-name">
                Designation name <span>*</span>
              </label>

              <input
                id="designation-name"
                autoFocus
                value={form.name}
                onChange={(event) => onChange('name', event.target.value)}
                placeholder="Example: Senior Software Developer"
                maxLength={120}
                required
              />

              <small>
                This is the main designation name shown in employee records and
                reporting workflows.
              </small>
            </div>

            <div className="designation-field">
              <label htmlFor="designation-title">Short title</label>

              <input
                id="designation-title"
                value={form.title}
                onChange={(event) => onChange('title', event.target.value)}
                placeholder="Example: Sr. Developer"
                maxLength={80}
              />

              <small>An optional shorter display title.</small>
            </div>

            <div className="designation-field">
              <label htmlFor="designation-department">Department</label>

              <select
                id="designation-department"
                value={form.department}
                onChange={(event) => onChange('department', event.target.value)}
              >
                <option value="">All / Not mapped</option>

                {departments.map((department) => {
                  const label = departmentOptionLabel(department);

                  return (
                    <option
                      key={recordId(department) || label}
                      value={label}
                    >
                      {label}
                    </option>
                  );
                })}
              </select>

              <small>
                Mapping is optional and helps filter designations by department.
              </small>
            </div>

            <div className="designation-field designation-field-full">
              <label htmlFor="designation-status">Status</label>

              <select
                id="designation-status"
                value={form.status}
                onChange={(event) => onChange('status', event.target.value)}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>

              <small>
                Inactive designations remain visible in historical employee
                records but should not be used for new assignments.
              </small>
            </div>
          </div>

          {error ? <div className="designation-form-error">{error}</div> : null}

          <footer className="designation-modal-footer">
            <button
              type="button"
              className="designation-secondary-button"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="designation-primary-button"
              disabled={saving}
            >
              {saving ? (
                <>
                  <RefreshCw size={17} className="is-spinning" />
                  Saving…
                </>
              ) : editing ? (
                <>
                  <Edit3 size={17} />
                  Save Changes
                </>
              ) : (
                <>
                  <Plus size={17} />
                  Create Designation
                </>
              )}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export default function Designations() {
  const [rows, setRows] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [form, setForm] = useState(EMPTY_FORM);
  const [editingRow, setEditingRow] = useState(null);
  const [formOpen, setFormOpen] = useState(false);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState('');

  const [pageError, setPageError] = useState('');
  const [formError, setFormError] = useState('');
  const [message, setMessage] = useState('');

  const loadDesignations = useCallback(
    async ({ silent = false } = {}) => {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setPageError('');

      try {
        const [designationData, departmentData] = await Promise.all([
          listCollection('designations', {
            page,
            limit: PAGE_SIZE,
            q: appliedSearch,
            sort_by: 'name',
            sort_dir: 'asc',
          }),
          getDepartments({ status: 'active' }).catch(() => ({ items: [] })),
        ]);

        setRows(Array.isArray(designationData.items) ? designationData.items : []);
        setTotal(Number(designationData.total || 0));
        setDepartments(
          Array.isArray(departmentData.items) ? departmentData.items : [],
        );
      } catch (error) {
        setRows([]);
        setTotal(0);
        setPageError(
          error?.message ||
            'Designations could not be loaded. Please check your access and try again.',
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [appliedSearch, page],
  );

  useEffect(() => {
    loadDesignations();
  }, [loadDesignations]);

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === 'Escape' && formOpen && !saving) {
        setFormOpen(false);
      }
    }

    window.addEventListener('keydown', closeOnEscape);

    return () => {
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [formOpen, saving]);

  const visibleRows = useMemo(
    () =>
      rows.filter((row) => {
        if (statusFilter && statusValue(row) !== statusFilter) {
          return false;
        }

        if (
          departmentFilter &&
          designationDepartment(row) !== departmentFilter
        ) {
          return false;
        }

        return true;
      }),
    [departmentFilter, rows, statusFilter],
  );

  const activeCount = useMemo(
    () => rows.filter((row) => statusValue(row) === 'active').length,
    [rows],
  );

  const inactiveCount = useMemo(
    () => rows.filter((row) => statusValue(row) === 'inactive').length,
    [rows],
  );

  const mappedCount = useMemo(
    () =>
      rows.filter(
        (row) => designationDepartment(row) !== 'All / Not mapped',
      ).length,
    [rows],
  );

  const uniqueDepartmentCount = useMemo(
    () =>
      new Set(
        rows
          .map(designationDepartment)
          .filter((value) => value !== 'All / Not mapped'),
      ).size,
    [rows],
  );

  const departmentOptions = useMemo(
    () =>
      [...new Set(
        rows
          .map(designationDepartment)
          .filter((value) => value !== 'All / Not mapped'),
      )].sort((first, second) => first.localeCompare(second)),
    [rows],
  );

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function updateForm(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function openCreateForm() {
    setEditingRow(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setMessage('');
    setFormOpen(true);
  }

  function openEditForm(row) {
    const name = designationName(row);

    setEditingRow(row);
    setForm({
      name: name === 'Unnamed Designation' ? '' : name,
      title: designationTitle(row),
      department:
        designationDepartment(row) === 'All / Not mapped'
          ? ''
          : designationDepartment(row),
      status: statusValue(row),
    });
    setFormError('');
    setMessage('');
    setFormOpen(true);
  }

  function closeForm() {
    if (saving) {
      return;
    }

    setFormOpen(false);
    setEditingRow(null);
    setForm(EMPTY_FORM);
    setFormError('');
  }

  function applySearch(event) {
    event.preventDefault();
    setPage(1);
    setAppliedSearch(searchInput.trim());
  }

  function clearFilters() {
    setSearchInput('');
    setAppliedSearch('');
    setDepartmentFilter('');
    setStatusFilter('');
    setPage(1);
  }

  async function submitDesignation(event) {
    event.preventDefault();

    const name = safeText(form.name);
    const title = safeText(form.title);
    const department = safeText(form.department);
    const status = safeText(form.status).toLowerCase() || 'active';

    if (!name) {
      setFormError('Designation name is required.');
      return;
    }

    const payload = {
      name,
      designation_name: name,
      title: title || name,
      department,
      status,
    };

    setSaving(true);
    setFormError('');
    setMessage('');

    try {
      if (editingRow) {
        const id = recordId(editingRow);

        if (!id) {
          throw new Error(
            'This designation cannot be updated because its internal reference is missing.',
          );
        }

        const response = await updateCollectionItem(
          'designations',
          id,
          payload,
        );

        setMessage(response?.message || 'Designation updated successfully.');
      } else {
        const response = await createCollectionItem('designations', payload);
        setMessage(response?.message || 'Designation created successfully.');
      }

      setFormOpen(false);
      setEditingRow(null);
      setForm(EMPTY_FORM);
      await loadDesignations({ silent: true });
    } catch (error) {
      setFormError(
        error?.message ||
          `Unable to ${editingRow ? 'update' : 'create'} the designation.`,
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeDesignation(row) {
    const id = recordId(row);
    const name = designationName(row);

    if (!id) {
      setPageError(
        'This designation cannot be removed because its internal reference is missing.',
      );
      return;
    }

    const confirmed = window.confirm(
      `Remove "${name}"?\n\nThe designation will become unavailable for new assignments but remain in historical records.`,
    );

    if (!confirmed) {
      return;
    }

    setDeletingId(id);
    setPageError('');
    setMessage('');

    try {
      const response = await deleteCollectionItem('designations', id);
      setMessage(response?.message || 'Designation removed successfully.');

      if (visibleRows.length === 1 && page > 1) {
        setPage((current) => Math.max(1, current - 1));
      } else {
        await loadDesignations({ silent: true });
      }
    } catch (error) {
      setPageError(error?.message || 'Unable to remove the designation.');
    } finally {
      setDeletingId('');
    }
  }

  const hasFilters = Boolean(
    appliedSearch || departmentFilter || statusFilter,
  );

  return (
    <section className="designations-page">
      <style>{`
        .designations-page {
          --designation-ink: #11182d;
          --designation-muted: #66748d;
          --designation-border: rgba(133, 149, 187, .28);
          --designation-primary: #4f46ef;
          display: grid;
          gap: 20px;
          width: 100%;
          padding-bottom: 34px;
          color: var(--designation-ink);
        }

        .designation-hero,
        .designation-panel {
          border: 1px solid var(--designation-border);
          border-radius: 30px;
          background: rgba(255, 255, 255, .91);
          box-shadow: 0 20px 55px rgba(38, 52, 88, .09);
          backdrop-filter: blur(16px);
        }

        .designation-hero {
          position: relative;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 24px;
          min-height: 210px;
          padding: 30px 34px;
          background:
            radial-gradient(circle at 5% 10%, rgba(91, 77, 242, .17), transparent 34%),
            radial-gradient(circle at 94% 8%, rgba(49, 176, 233, .17), transparent 31%),
            linear-gradient(125deg, rgba(255, 255, 255, .97), rgba(247, 250, 255, .94));
        }

        .designation-hero::after {
          content: '';
          position: absolute;
          right: -66px;
          bottom: -96px;
          width: 250px;
          height: 250px;
          border: 38px solid rgba(79, 70, 239, .05);
          border-radius: 50%;
          pointer-events: none;
        }

        .designation-hero-copy {
          position: relative;
          z-index: 1;
          max-width: 810px;
        }

        .designation-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: var(--designation-primary);
          font-size: 12px;
          font-weight: 900;
          letter-spacing: .1em;
          text-transform: uppercase;
        }

        .designation-hero h1 {
          margin: 11px 0 8px;
          font-size: clamp(32px, 4vw, 49px);
          line-height: 1.03;
          letter-spacing: -.04em;
        }

        .designation-hero p {
          max-width: 770px;
          margin: 0;
          color: var(--designation-muted);
          font-size: 16px;
          line-height: 1.7;
        }

        .designation-primary-button,
        .designation-secondary-button,
        .designation-icon-button,
        .designation-action-button,
        .designation-page-button {
          border: 0;
          font: inherit;
          cursor: pointer;
          transition:
            transform .18s ease,
            box-shadow .18s ease,
            background .18s ease,
            border-color .18s ease;
        }

        .designation-primary-button,
        .designation-secondary-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-height: 47px;
          padding: 0 18px;
          border-radius: 14px;
          font-weight: 850;
        }

        .designation-primary-button {
          position: relative;
          z-index: 1;
          flex: 0 0 auto;
          background: linear-gradient(135deg, #5147f4, #6b5df8);
          color: #fff;
          box-shadow: 0 14px 29px rgba(79, 70, 239, .25);
        }

        .designation-secondary-button {
          border: 1px solid rgba(133, 149, 187, .32);
          background: #fff;
          color: #344054;
        }

        .designation-primary-button:hover:not(:disabled),
        .designation-secondary-button:hover:not(:disabled),
        .designation-action-button:hover:not(:disabled),
        .designation-page-button:hover:not(:disabled),
        .designation-icon-button:hover:not(:disabled) {
          transform: translateY(-2px);
        }

        .designation-primary-button:disabled,
        .designation-secondary-button:disabled,
        .designation-action-button:disabled,
        .designation-page-button:disabled,
        .designation-icon-button:disabled {
          cursor: not-allowed;
          opacity: .55;
        }

        .is-spinning {
          animation: designation-spin .8s linear infinite;
        }

        @keyframes designation-spin {
          to { transform: rotate(360deg); }
        }

        .designation-kpi-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
        }

        .designation-kpi {
          display: flex;
          align-items: center;
          gap: 14px;
          min-height: 108px;
          padding: 20px;
          border: 1px solid var(--designation-border);
          border-radius: 22px;
          background: rgba(255, 255, 255, .92);
          box-shadow: 0 13px 34px rgba(38, 52, 88, .07);
        }

        .designation-kpi-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 46px;
          height: 46px;
          flex: 0 0 46px;
          border-radius: 15px;
          background: rgba(79, 70, 239, .09);
          color: var(--designation-primary);
        }

        .designation-kpi span {
          display: block;
          color: var(--designation-muted);
          font-size: 11px;
          font-weight: 900;
          letter-spacing: .055em;
          text-transform: uppercase;
        }

        .designation-kpi strong {
          display: block;
          margin-top: 5px;
          font-size: 24px;
          line-height: 1.1;
        }

        .designation-kpi small {
          display: block;
          margin-top: 5px;
          color: #8791a7;
          line-height: 1.35;
        }

        .designation-panel {
          overflow: hidden;
        }

        .designation-toolbar {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 18px;
          padding: 24px 26px 18px;
        }

        .designation-toolbar-heading {
          display: flex;
          align-items: center;
          gap: 11px;
        }

        .designation-toolbar-heading h2 {
          margin: 0;
          font-size: 21px;
        }

        .designation-toolbar-heading p {
          margin: 4px 0 0;
          color: var(--designation-muted);
          font-size: 13px;
        }

        .designation-search-row {
          display: grid;
          grid-template-columns:
            minmax(250px, 1fr)
            minmax(180px, 260px)
            minmax(160px, 220px)
            auto;
          gap: 12px;
          padding: 0 26px 24px;
        }

        .designation-field {
          display: grid;
          gap: 7px;
        }

        .designation-field label {
          color: #46536b;
          font-size: 12px;
          font-weight: 850;
        }

        .designation-field label span {
          color: #dc2626;
        }

        .designation-input-wrap {
          position: relative;
        }

        .designation-input-wrap > svg {
          position: absolute;
          top: 50%;
          left: 14px;
          transform: translateY(-50%);
          color: #78839c;
          pointer-events: none;
        }

        .designation-field input,
        .designation-field select {
          width: 100%;
          min-height: 46px;
          border: 1px solid rgba(133, 149, 187, .36);
          border-radius: 14px;
          outline: none;
          background: rgba(248, 250, 255, .88);
          color: var(--designation-ink);
          font: inherit;
          padding: 0 14px;
          transition:
            border-color .18s ease,
            box-shadow .18s ease,
            background .18s ease;
        }

        .designation-input-wrap input {
          padding-left: 43px;
        }

        .designation-field input:focus,
        .designation-field select:focus {
          border-color: rgba(79, 70, 239, .58);
          background: #fff;
          box-shadow: 0 0 0 4px rgba(79, 70, 239, .09);
        }

        .designation-field small {
          color: var(--designation-muted);
          font-size: 12px;
          line-height: 1.45;
        }

        .designation-feedback {
          margin: 0 26px 20px;
          padding: 14px 16px;
          border-radius: 15px;
          font-weight: 750;
        }

        .designation-feedback.success {
          border: 1px solid rgba(16, 185, 129, .22);
          background: rgba(209, 250, 229, .58);
          color: #08775c;
        }

        .designation-feedback.error {
          border: 1px solid rgba(220, 38, 38, .2);
          background: rgba(254, 226, 226, .62);
          color: #ac2029;
        }

        .designation-clear-row {
          padding: 0 26px 18px;
        }

        .designation-table-wrap {
          overflow-x: auto;
          border-top: 1px solid rgba(133, 149, 187, .2);
          -webkit-overflow-scrolling: touch;
        }

        .designation-table {
          width: 100%;
          min-width: 940px;
          border-collapse: collapse;
        }

        .designation-table th {
          padding: 14px 18px;
          background: rgba(246, 248, 253, .97);
          color: #536078;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: .065em;
          text-align: left;
          text-transform: uppercase;
          white-space: nowrap;
        }

        .designation-table td {
          padding: 17px 18px;
          border-top: 1px solid rgba(133, 149, 187, .15);
          vertical-align: middle;
        }

        .designation-table tbody tr {
          transition: background .18s ease;
        }

        .designation-table tbody tr:hover {
          background: rgba(79, 70, 239, .035);
        }

        .designation-name-cell {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 250px;
        }

        .designation-name-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 42px;
          height: 42px;
          flex: 0 0 42px;
          border-radius: 13px;
          background: rgba(79, 70, 239, .085);
          color: #4f46ef;
        }

        .designation-name-cell strong {
          display: block;
        }

        .designation-name-cell small {
          display: block;
          margin-top: 4px;
          color: var(--designation-muted);
        }

        .designation-department {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          width: fit-content;
          max-width: 230px;
          padding: 7px 10px;
          border-radius: 11px;
          background: rgba(59, 130, 246, .09);
          color: #285f9f;
          font-size: 12px;
          font-weight: 850;
        }

        .designation-department span {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .designation-status {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          min-height: 32px;
          padding: 0 11px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 850;
          white-space: nowrap;
        }

        .designation-status.active {
          background: rgba(16, 185, 129, .11);
          color: #08775c;
        }

        .designation-status.inactive {
          background: rgba(100, 116, 139, .11);
          color: #596579;
        }

        .designation-updated {
          display: grid;
          gap: 4px;
          min-width: 170px;
        }

        .designation-updated small {
          color: var(--designation-muted);
        }

        .designation-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          white-space: nowrap;
        }

        .designation-action-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          min-height: 38px;
          padding: 0 12px;
          border: 1px solid rgba(133, 149, 187, .3);
          border-radius: 12px;
          background: #fff;
          color: #344054;
          font-weight: 820;
        }

        .designation-action-button.edit {
          border-color: rgba(79, 70, 239, .23);
          background: rgba(79, 70, 239, .055);
          color: #433bb8;
        }

        .designation-action-button.delete {
          border-color: rgba(220, 38, 38, .18);
          background: rgba(254, 226, 226, .45);
          color: #b4232c;
        }

        .designation-loading {
          display: grid;
          gap: 11px;
          padding: 28px 26px;
          border-top: 1px solid rgba(133, 149, 187, .18);
        }

        .designation-loading span {
          display: block;
          height: 58px;
          border-radius: 15px;
          background:
            linear-gradient(
              90deg,
              rgba(231, 235, 245, .7),
              rgba(250, 251, 255, .97),
              rgba(231, 235, 245, .7)
            );
          background-size: 220% 100%;
          animation: designation-skeleton 1.25s linear infinite;
        }

        @keyframes designation-skeleton {
          to { background-position: -220% 0; }
        }

        .designation-empty {
          display: grid;
          justify-items: center;
          gap: 10px;
          padding: 50px 22px;
          border-top: 1px solid rgba(133, 149, 187, .18);
          color: var(--designation-muted);
          text-align: center;
        }

        .designation-empty svg {
          color: #7066df;
        }

        .designation-empty h3 {
          margin: 0;
          color: var(--designation-ink);
        }

        .designation-empty p {
          max-width: 540px;
          margin: 0;
          line-height: 1.6;
        }

        .designation-mobile-list {
          display: none;
          gap: 12px;
          padding: 16px;
          border-top: 1px solid rgba(133, 149, 187, .18);
        }

        .designation-mobile-card {
          display: grid;
          gap: 14px;
          padding: 17px;
          border: 1px solid rgba(133, 149, 187, .23);
          border-radius: 18px;
          background: rgba(255, 255, 255, .98);
          box-shadow: 0 10px 26px rgba(38, 52, 88, .06);
        }

        .designation-mobile-top,
        .designation-mobile-bottom {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
        }

        .designation-mobile-title {
          display: flex;
          align-items: center;
          gap: 11px;
          min-width: 0;
        }

        .designation-mobile-title > div:last-child {
          min-width: 0;
        }

        .designation-mobile-title h3 {
          margin: 0;
          overflow-wrap: anywhere;
          font-size: 17px;
        }

        .designation-mobile-title p {
          margin: 4px 0 0;
          color: var(--designation-muted);
          font-size: 13px;
        }

        .designation-mobile-meta {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }

        .designation-mobile-meta article {
          min-width: 0;
          padding: 11px;
          border-radius: 13px;
          background: rgba(247, 248, 253, .92);
        }

        .designation-mobile-meta span {
          display: block;
          color: var(--designation-muted);
          font-size: 11px;
          font-weight: 850;
          text-transform: uppercase;
        }

        .designation-mobile-meta strong {
          display: block;
          margin-top: 5px;
          overflow-wrap: anywhere;
          font-size: 13px;
        }

        .designation-pagination {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 18px 24px;
          border-top: 1px solid rgba(133, 149, 187, .18);
        }

        .designation-pagination p {
          margin: 0;
          color: var(--designation-muted);
          font-size: 13px;
        }

        .designation-pagination-controls {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .designation-page-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          border: 1px solid rgba(133, 149, 187, .3);
          border-radius: 12px;
          background: #fff;
          color: #3d4960;
        }

        .designation-page-indicator {
          min-width: 88px;
          text-align: center;
          color: #3d4960;
          font-size: 13px;
          font-weight: 800;
        }

        .designation-modal-backdrop {
          position: fixed;
          z-index: 2600;
          inset: 0;
          display: grid;
          place-items: center;
          padding: 22px;
          background: rgba(14, 22, 42, .56);
          backdrop-filter: blur(8px);
        }

        .designation-modal {
          width: min(720px, 100%);
          max-height: 92vh;
          overflow-y: auto;
          border: 1px solid rgba(255, 255, 255, .45);
          border-radius: 28px;
          background: #fff;
          box-shadow: 0 34px 90px rgba(9, 16, 35, .3);
          animation: designation-modal-enter .2s ease-out;
        }

        @keyframes designation-modal-enter {
          from {
            opacity: 0;
            transform: translateY(12px) scale(.985);
          }

          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        .designation-modal-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 20px;
          padding: 27px 28px 22px;
          border-bottom: 1px solid rgba(133, 149, 187, .18);
          background:
            radial-gradient(circle at 92% 0%, rgba(49, 176, 233, .15), transparent 35%),
            radial-gradient(circle at 5% 0%, rgba(99, 88, 245, .14), transparent 39%),
            #fff;
        }

        .designation-modal-header h2 {
          margin: 8px 0 6px;
          font-size: 28px;
          letter-spacing: -.025em;
        }

        .designation-modal-header p {
          max-width: 540px;
          margin: 0;
          color: var(--designation-muted);
          line-height: 1.55;
        }

        .designation-icon-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 42px;
          height: 42px;
          flex: 0 0 42px;
          border-radius: 13px;
          background: rgba(255, 255, 255, .82);
          color: #36435a;
          box-shadow: 0 8px 24px rgba(40, 52, 84, .1);
        }

        .designation-form {
          display: grid;
          gap: 18px;
          padding: 24px 28px 28px;
        }

        .designation-form-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 18px;
        }

        .designation-field-full {
          grid-column: 1 / -1;
        }

        .designation-form-error {
          padding: 14px 15px;
          border: 1px solid rgba(220, 38, 38, .2);
          border-radius: 14px;
          background: rgba(254, 226, 226, .6);
          color: #a91e28;
          font-weight: 750;
        }

        .designation-modal-footer {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          padding-top: 4px;
        }

        @media (max-width: 1050px) {
          .designation-kpi-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .designation-search-row {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .designation-search-row > button {
            grid-column: 1 / -1;
          }
        }

        @media (max-width: 860px) {
          .designation-table-wrap {
            display: none;
          }

          .designation-mobile-list {
            display: grid;
          }
        }

        @media (max-width: 640px) {
          .designations-page {
            gap: 16px;
          }

          .designation-hero {
            align-items: flex-start;
            flex-direction: column;
            min-height: auto;
            padding: 25px 21px;
            border-radius: 24px;
          }

          .designation-hero .designation-primary-button {
            width: 100%;
          }

          .designation-kpi-grid {
            grid-template-columns: 1fr;
          }

          .designation-kpi {
            min-height: 92px;
          }

          .designation-toolbar {
            align-items: flex-start;
            flex-direction: column;
            padding: 21px 18px 16px;
          }

          .designation-toolbar .designation-secondary-button {
            width: 100%;
          }

          .designation-search-row {
            grid-template-columns: 1fr;
            padding: 0 18px 20px;
          }

          .designation-search-row > button {
            grid-column: auto;
            width: 100%;
          }

          .designation-clear-row {
            padding-left: 18px;
            padding-right: 18px;
          }

          .designation-clear-row button {
            width: 100%;
          }

          .designation-feedback {
            margin-left: 18px;
            margin-right: 18px;
          }

          .designation-mobile-list {
            padding-left: 12px;
            padding-right: 12px;
          }

          .designation-mobile-bottom {
            flex-direction: column;
          }

          .designation-actions {
            width: 100%;
          }

          .designation-actions .designation-action-button {
            flex: 1 1 0;
          }

          .designation-pagination {
            align-items: flex-start;
            flex-direction: column;
          }

          .designation-pagination-controls {
            width: 100%;
            justify-content: space-between;
          }

          .designation-modal-backdrop {
            align-items: end;
            padding: 0;
          }

          .designation-modal {
            width: 100%;
            max-height: 94vh;
            border-radius: 25px 25px 0 0;
          }

          .designation-modal-header,
          .designation-form {
            padding-left: 19px;
            padding-right: 19px;
          }

          .designation-form-grid {
            grid-template-columns: 1fr;
          }

          .designation-field-full {
            grid-column: auto;
          }

          .designation-modal-footer {
            flex-direction: column-reverse;
          }

          .designation-modal-footer button {
            width: 100%;
          }
        }

        @media (max-width: 430px) {
          .designation-mobile-top {
            flex-direction: column;
          }

          .designation-mobile-meta {
            grid-template-columns: 1fr;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .designations-page *,
          .designations-page *::before,
          .designations-page *::after {
            animation-duration: .01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: .01ms !important;
          }
        }


        /* YourComate reference-design overrides */
        .designations-page {
          --designation-ink: #101a3a;
          --designation-muted: #596483;
          --designation-primary: #6254da;
          --designation-deep: #342b78;
          --designation-blue: #3766db;
          --designation-teal: #18aaa8;
          --designation-flat-blue: #b9d7ff;
          --designation-flat-violet: #c9c0ff;
          --designation-flat-teal: #aee6d9;
          --designation-ease: cubic-bezier(.22, 1, .36, 1);
          gap: 22px;
          min-width: 0;
          padding-bottom: max(34px, env(safe-area-inset-bottom));
          color: var(--designation-ink);
          font-family: var(--yc-ui, var(--body), inherit);
        }

        .designation-hero {
          isolation: isolate;
          min-height: 230px;
          padding: clamp(25px, 3vw, 40px);
          border: 1px solid rgba(171, 181, 211, .72);
          border-radius: clamp(28px, 2.5vw, 40px);
          background:
            radial-gradient(circle at 8% 8%, rgba(121, 219, 238, .34), transparent 31%),
            radial-gradient(circle at 92% 12%, rgba(191, 190, 249, .3), transparent 34%),
            linear-gradient(135deg, #f1fbff 0%, #fffdf8 48%, #f8f2ff 100%);
          box-shadow:
            12px 14px 0 var(--designation-flat-blue),
            0 28px 48px rgba(34, 38, 110, .13);
        }

        .designation-hero::before {
          content: "";
          position: absolute;
          inset: 0;
          z-index: -2;
          opacity: .42;
          pointer-events: none;
          background-image:
            linear-gradient(rgba(65, 55, 161, .035) 1px, transparent 1px),
            linear-gradient(90deg, rgba(65, 55, 161, .035) 1px, transparent 1px);
          background-size: 42px 42px;
        }

        .designation-hero::after {
          z-index: -1;
          width: clamp(165px, 20vw, 290px);
          height: auto;
          aspect-ratio: 1;
          right: clamp(-110px, -7vw, -55px);
          top: clamp(-118px, -8vw, -60px);
          bottom: auto;
          border: 1px solid rgba(65, 55, 161, .12);
          border-radius: 34% 66% 58% 42% / 44% 38% 62% 56%;
          background: linear-gradient(145deg, rgba(105, 217, 208, .72), rgba(121, 189, 242, .72));
          transform: rotate(18deg);
        }

        .designation-hero-copy {
          max-width: 840px;
          min-width: 0;
        }

        .designation-eyebrow {
          width: fit-content;
          padding: 9px 13px;
          border-radius: 999px;
          color: #fff;
          background: var(--designation-deep);
          font-size: 9px;
          line-height: 1;
          letter-spacing: .12em;
        }

        .designation-hero h1 {
          margin: 15px 0 10px;
          color: var(--designation-ink);
          font-family: var(--yc-display, var(--heading), inherit);
          font-size: clamp(34px, 4.4vw, 66px);
          font-weight: 760;
          line-height: .94;
          letter-spacing: -.055em;
        }

        .designation-hero p {
          max-width: 790px;
          color: var(--designation-muted);
          font-size: clamp(13px, 1vw, 16px);
          line-height: 1.68;
        }

        .designation-primary-button,
        .designation-secondary-button,
        .designation-icon-button,
        .designation-action-button,
        .designation-page-button {
          touch-action: manipulation;
          font-weight: 900;
          transition:
            transform 240ms var(--designation-ease),
            box-shadow 240ms var(--designation-ease),
            border-color 200ms ease,
            background 200ms ease,
            color 200ms ease,
            filter 200ms ease;
        }

        .designation-primary-button {
          border: 1px solid rgba(52, 43, 120, .16);
          background: linear-gradient(145deg, #4f72df, #2bb9b5);
          box-shadow:
            5px 6px 0 rgba(52, 43, 120, .8),
            0 12px 22px rgba(55, 102, 219, .16);
        }

        .designation-secondary-button {
          border-color: rgba(98, 84, 218, .18);
          color: var(--designation-deep);
          background: #f1efff;
          box-shadow: 4px 5px 0 rgba(98, 84, 218, .14);
        }

        .designation-primary-button:hover:not(:disabled),
        .designation-secondary-button:hover:not(:disabled),
        .designation-action-button:hover:not(:disabled),
        .designation-page-button:hover:not(:disabled),
        .designation-icon-button:hover:not(:disabled) {
          transform: translateY(-2px);
          filter: saturate(1.04);
        }

        .designation-primary-button:active:not(:disabled),
        .designation-secondary-button:active:not(:disabled),
        .designation-action-button:active:not(:disabled),
        .designation-page-button:active:not(:disabled),
        .designation-icon-button:active:not(:disabled) {
          transform: translateY(0) scale(.985);
        }

        .designation-kpi-grid {
          gap: 16px;
        }

        .designation-kpi {
          min-width: 0;
          min-height: 112px;
          padding: 19px;
          border-color: rgba(171, 181, 211, .68);
          border-radius: 22px;
          background: #f8fbff;
          box-shadow:
            7px 9px 0 var(--designation-flat-blue),
            0 18px 30px rgba(15, 20, 75, .08);
          transition:
            transform 260ms var(--designation-ease),
            border-color 220ms ease,
            box-shadow 260ms var(--designation-ease);
        }

        .designation-kpi:nth-child(2) {
          background: #eaf8f4;
          box-shadow:
            7px 9px 0 var(--designation-flat-teal),
            0 18px 30px rgba(15, 20, 75, .08);
        }

        .designation-kpi:nth-child(3) {
          background: #f1efff;
          box-shadow:
            7px 9px 0 var(--designation-flat-violet),
            0 18px 30px rgba(15, 20, 75, .08);
        }

        .designation-kpi:nth-child(4) {
          background: #fff4d5;
          box-shadow:
            7px 9px 0 #ffe0a5,
            0 18px 30px rgba(15, 20, 75, .08);
        }

        .designation-kpi:hover {
          transform: translateY(-3px);
          border-color: rgba(98, 84, 218, .3);
        }

        .designation-kpi-icon,
        .designation-name-icon {
          border: 1px solid rgba(52, 43, 120, .15);
          color: #fff;
          background: linear-gradient(145deg, #4f72df, #2bb9b5);
          box-shadow: 4px 5px 0 rgba(98, 84, 218, .16);
        }

        .designation-kpi strong {
          color: var(--designation-ink);
          font-family: var(--yc-display, var(--heading), inherit);
          font-size: 29px;
          letter-spacing: -.035em;
        }

        .designation-kpi span,
        .designation-kpi small {
          color: var(--designation-muted);
        }

        .designation-panel {
          min-width: 0;
          border-color: rgba(171, 181, 211, .72);
          border-radius: clamp(24px, 2vw, 32px);
          background: linear-gradient(145deg, rgba(255,255,255,.99), rgba(244,249,255,.98));
          box-shadow:
            9px 11px 0 #d1dcfa,
            0 24px 42px rgba(34, 38, 110, .1);
        }

        .designation-toolbar {
          border-bottom: 1px solid rgba(65, 55, 161, .08);
          background: rgba(255, 255, 255, .64);
        }

        .designation-toolbar-heading > svg {
          color: var(--designation-primary);
        }

        .designation-toolbar-heading h2 {
          color: var(--designation-ink);
          font-family: var(--yc-display, var(--heading), inherit);
          font-size: clamp(22px, 2vw, 30px);
          font-weight: 760;
          line-height: 1;
          letter-spacing: -.03em;
        }

        .designation-toolbar-heading p {
          color: var(--designation-muted);
        }

        .designation-search-row {
          background: linear-gradient(145deg, rgba(237,248,255,.44), rgba(248,241,255,.34));
        }

        .designation-field {
          min-width: 0;
        }

        .designation-field label {
          color: #334164;
          font-weight: 900;
        }

        .designation-input-wrap > svg {
          color: var(--designation-primary);
        }

        .designation-field input,
        .designation-field select {
          min-width: 0;
          border-color: rgba(159, 169, 205, .62);
          background: rgba(255, 255, 255, .88);
          color: var(--designation-ink);
        }

        .designation-field input:hover,
        .designation-field select:hover {
          border-color: rgba(98, 84, 218, .34);
        }

        .designation-field input:focus,
        .designation-field select:focus {
          border-color: var(--designation-primary);
          background: #fff;
          box-shadow: 0 0 0 4px rgba(98, 84, 218, .11);
        }

        .designation-feedback {
          animation: designationFeedbackEnter 360ms var(--designation-ease) both;
        }

        @keyframes designationFeedbackEnter {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .designation-feedback.success {
          border-color: rgba(19, 115, 111, .2);
          color: #13736f;
          background: #dff8f3;
        }

        .designation-feedback.error,
        .designation-form-error {
          border-color: rgba(190, 47, 85, .18);
          color: #b62f55;
          background: #ffe4ec;
        }

        .designation-table-wrap {
          border-top-color: rgba(65, 55, 161, .1);
          overscroll-behavior-x: contain;
          scrollbar-width: thin;
          scrollbar-color: rgba(98, 84, 218, .35) transparent;
        }

        .designation-table-wrap::-webkit-scrollbar {
          height: 8px;
        }

        .designation-table-wrap::-webkit-scrollbar-thumb {
          border-radius: 999px;
          background: rgba(98, 84, 218, .35);
        }

        .designation-table th {
          position: sticky;
          top: 0;
          z-index: 2;
          border-bottom: 1px solid rgba(65, 55, 161, .11);
          color: #4f5e7f;
          background: rgba(241, 239, 255, .94);
          backdrop-filter: blur(12px);
          font-size: 10px;
        }

        .designation-table td {
          border-top-color: rgba(65, 55, 161, .09);
          color: #334164;
          background: rgba(255, 255, 255, .62);
        }

        .designation-table tbody tr:hover {
          background: transparent;
        }

        .designation-table tbody tr:hover td {
          background: rgba(237, 246, 255, .82);
        }

        .designation-name-cell strong {
          color: var(--designation-ink);
          font-weight: 950;
        }

        .designation-department {
          border-radius: 999px;
          color: #3657b5;
          background: #e5e9ff;
        }

        .designation-status.active {
          color: #13736f;
          background: #dff8f3;
        }

        .designation-status.inactive {
          color: #5f6983;
          background: #edf0f6;
        }

        .designation-action-button.edit {
          border-color: rgba(98, 84, 218, .18);
          color: var(--designation-deep);
          background: #f1efff;
          box-shadow: 3px 4px 0 rgba(98, 84, 218, .12);
        }

        .designation-action-button.delete {
          border-color: rgba(190, 47, 85, .18);
          color: #b62f55;
          background: #ffe4ec;
        }

        .designation-loading span {
          border: 1px solid rgba(171, 181, 211, .5);
          background:
            linear-gradient(90deg, #edf6ff 25%, #fff 37%, #f1efff 50%, #fff 63%, #edf6ff 75%);
          background-size: 400% 100%;
        }

        .designation-empty {
          border-top-color: rgba(65, 55, 161, .1);
          background: linear-gradient(145deg, rgba(237,248,255,.58), rgba(248,241,255,.52));
        }

        .designation-empty svg {
          color: var(--designation-primary);
        }

        .designation-mobile-card {
          border-color: rgba(171, 181, 211, .64);
          background: linear-gradient(145deg, rgba(255,255,255,.98), rgba(244,249,255,.94));
          box-shadow:
            5px 6px 0 rgba(185, 215, 255, .72),
            0 14px 24px rgba(34, 38, 110, .07);
          transition:
            transform 240ms var(--designation-ease),
            border-color 200ms ease,
            box-shadow 240ms var(--designation-ease);
        }

        .designation-mobile-card:hover {
          transform: translateY(-2px);
          border-color: rgba(98, 84, 218, .3);
        }

        .designation-mobile-meta article {
          border: 1px solid rgba(98, 84, 218, .08);
          background: rgba(241, 239, 255, .52);
        }

        .designation-pagination {
          border-top-color: rgba(65, 55, 161, .1);
          background: rgba(255, 255, 255, .66);
        }

        .designation-page-button {
          border-color: rgba(98, 84, 218, .18);
          color: var(--designation-deep);
          background: #f1efff;
          box-shadow: 3px 4px 0 rgba(98, 84, 218, .12);
        }

        .designation-modal-backdrop {
          z-index: 10000;
          width: 100vw;
          height: 100dvh;
          overflow: hidden;
          padding:
            max(14px, env(safe-area-inset-top))
            max(14px, env(safe-area-inset-right))
            max(14px, env(safe-area-inset-bottom))
            max(14px, env(safe-area-inset-left));
          background: rgba(15, 23, 42, .48);
          backdrop-filter: blur(9px);
          -webkit-backdrop-filter: blur(9px);
          animation: designationBackdropEnter 260ms ease both;
        }

        @keyframes designationBackdropEnter {
          from { opacity: 0; backdrop-filter: blur(0); }
          to { opacity: 1; backdrop-filter: blur(9px); }
        }

        .designation-modal {
          width: min(760px, 100%);
          max-height: calc(100dvh - 28px);
          overscroll-behavior: contain;
          border-color: rgba(171, 181, 211, .72);
          background: linear-gradient(145deg, #fff 0%, #f4fbff 52%, #f8f1ff 100%);
          box-shadow:
            0 34px 90px rgba(34, 38, 110, .25),
            10px 12px 0 rgba(185, 215, 255, .5);
          animation: designationModalEnter 420ms var(--designation-ease) both;
          transform-origin: 50% 14%;
          -webkit-overflow-scrolling: touch;
        }

        @keyframes designationModalEnter {
          from {
            opacity: 0;
            transform: translateY(22px) scale(.965);
            filter: blur(4px);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: blur(0);
          }
        }

        .designation-modal-header {
          position: sticky;
          top: 0;
          z-index: 3;
          border-bottom-color: rgba(65, 55, 161, .11);
          background:
            radial-gradient(circle at 92% 0%, rgba(105,217,208,.16), transparent 35%),
            radial-gradient(circle at 5% 0%, rgba(98,84,218,.14), transparent 39%),
            rgba(255,255,255,.92);
          backdrop-filter: blur(14px);
        }

        .designation-modal-header h2 {
          color: var(--designation-ink);
          font-family: var(--yc-display, var(--heading), inherit);
          font-size: 29px;
          font-weight: 760;
          line-height: 1;
          letter-spacing: -.035em;
        }

        .designation-icon-button {
          border: 1px solid rgba(98, 84, 218, .18);
          color: var(--designation-deep);
          background: #f1efff;
          box-shadow: 4px 5px 0 rgba(98, 84, 218, .14);
        }

        .designation-modal-footer {
          position: sticky;
          bottom: 0;
          z-index: 3;
          margin: 0 -28px -28px;
          padding: 16px 28px max(18px, env(safe-area-inset-bottom));
          border-top: 1px solid rgba(65, 55, 161, .11);
          background: rgba(255,255,255,.9);
          backdrop-filter: blur(14px);
        }

        @media (min-width: 1600px) {
          .designation-hero {
            min-height: 245px;
          }
        }

        @media (max-width: 640px) {
          .designation-hero {
            padding: 20px;
            box-shadow:
              7px 8px 0 var(--designation-flat-blue),
              0 18px 30px rgba(34, 38, 110, .1);
          }

          .designation-kpi-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
          }

          .designation-kpi {
            min-height: 118px;
            padding: 14px;
            border-radius: 17px;
          }

          .designation-panel {
            box-shadow:
              6px 7px 0 #d1dcfa,
              0 16px 28px rgba(34, 38, 110, .08);
          }

          .designation-modal {
            max-height: calc(100dvh - max(8px, env(safe-area-inset-top)));
            box-shadow: 0 -18px 60px rgba(34, 38, 110, .24);
            animation-name: designationMobileSheetEnter;
            transform-origin: 50% 100%;
          }

          @keyframes designationMobileSheetEnter {
            from {
              opacity: 0;
              transform: translateY(100%);
              filter: blur(3px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
              filter: blur(0);
            }
          }
        }

        @media (max-width: 430px) {
          .designation-kpi-grid {
            grid-template-columns: 1fr;
          }

          .designation-kpi {
            min-height: auto;
          }
        }

      `}</style>

      <header className="designation-hero">
        <div className="designation-hero-copy">
          <span className="designation-eyebrow">
            <ShieldCheck size={17} />
            Employee setup
          </span>

          <h1>Designations</h1>

          <p>
            Maintain the job titles used in employee records, user control,
            reporting hierarchy and workforce filtering. Internal database IDs are
            intentionally hidden from this interface.
          </p>
        </div>

        <button
          type="button"
          className="designation-primary-button"
          onClick={openCreateForm}
        >
          <Plus size={18} />
          Add Designation
        </button>
      </header>

      <div className="designation-kpi-grid">
        <article className="designation-kpi">
          <span className="designation-kpi-icon">
            <BriefcaseBusiness size={22} />
          </span>

          <div>
            <span>Total designations</span>
            <strong>{total.toLocaleString('en-IN')}</strong>
            <small>Available in your company scope</small>
          </div>
        </article>

        <article className="designation-kpi">
          <span className="designation-kpi-icon">
            <BadgeCheck size={22} />
          </span>

          <div>
            <span>Active on page</span>
            <strong>{activeCount.toLocaleString('en-IN')}</strong>
            <small>Available for new employee assignments</small>
          </div>
        </article>

        <article className="designation-kpi">
          <span className="designation-kpi-icon">
            <CircleOff size={22} />
          </span>

          <div>
            <span>Inactive on page</span>
            <strong>{inactiveCount.toLocaleString('en-IN')}</strong>
            <small>Retained in historical employee records</small>
          </div>
        </article>

        <article className="designation-kpi">
          <span className="designation-kpi-icon">
            <Layers3 size={22} />
          </span>

          <div>
            <span>Department mapped</span>
            <strong>{mappedCount.toLocaleString('en-IN')}</strong>
            <small>
              Across {uniqueDepartmentCount.toLocaleString('en-IN')} department
              {uniqueDepartmentCount === 1 ? '' : 's'}
            </small>
          </div>
        </article>
      </div>

      <section className="designation-panel">
        <div className="designation-toolbar">
          <div className="designation-toolbar-heading">
            <Activity size={21} />

            <div>
              <h2>Designation directory</h2>
              <p>
                Search, create, update and safely deactivate designations without
                exposing internal IDs.
              </p>
            </div>
          </div>

          <button
            type="button"
            className="designation-secondary-button"
            onClick={() => loadDesignations({ silent: true })}
            disabled={refreshing}
          >
            <RefreshCw
              size={17}
              className={refreshing ? 'is-spinning' : ''}
            />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        <form className="designation-search-row" onSubmit={applySearch}>
          <div className="designation-field">
            <label htmlFor="designation-search">Search designations</label>

            <div className="designation-input-wrap">
              <Search size={18} />

              <input
                id="designation-search"
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Designation name or short title"
              />
            </div>
          </div>

          <div className="designation-field">
            <label htmlFor="designation-department-filter">Department</label>

            <select
              id="designation-department-filter"
              value={departmentFilter}
              onChange={(event) => setDepartmentFilter(event.target.value)}
            >
              <option value="">All departments</option>

              {departmentOptions.map((department) => (
                <option key={department} value={department}>
                  {department}
                </option>
              ))}
            </select>
          </div>

          <div className="designation-field">
            <label htmlFor="designation-status-filter">Status</label>

            <select
              id="designation-status-filter"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="">All statuses</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </select>
          </div>

          <button type="submit" className="designation-primary-button">
            <Search size={17} />
            Search
          </button>
        </form>

        {hasFilters ? (
          <div className="designation-clear-row">
            <button
              type="button"
              className="designation-secondary-button"
              onClick={clearFilters}
            >
              <X size={17} />
              Clear Filters
            </button>
          </div>
        ) : null}

        {message ? (
          <div className="designation-feedback success">{message}</div>
        ) : null}

        {pageError ? (
          <div className="designation-feedback error">{pageError}</div>
        ) : null}

        {loading ? (
          <div className="designation-loading" aria-label="Loading designations">
            <span />
            <span />
            <span />
            <span />
          </div>
        ) : visibleRows.length > 0 ? (
          <>
            <div className="designation-table-wrap">
              <table className="designation-table">
                <thead>
                  <tr>
                    <th>Designation</th>
                    <th>Department</th>
                    <th>Status</th>
                    <th>Last updated</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {visibleRows.map((row, index) => {
                    const id = recordId(row);
                    const status = statusValue(row);
                    const title = designationTitle(row);

                    return (
                      <tr
                        key={
                          id ||
                          `${designationName(row)}-${designationDepartment(row)}-${index}`
                        }
                      >
                        <td>
                          <div className="designation-name-cell">
                            <span className="designation-name-icon">
                              <UserRoundCog size={20} />
                            </span>

                            <div>
                              <strong>{designationName(row)}</strong>
                              <small>
                                {title || 'No separate short title'}
                              </small>
                            </div>
                          </div>
                        </td>

                        <td>
                          <span className="designation-department">
                            <Building2 size={15} />
                            <span>{designationDepartment(row)}</span>
                          </span>
                        </td>

                        <td>
                          <span className={`designation-status ${status}`}>
                            {status === 'active' ? (
                              <BadgeCheck size={15} />
                            ) : (
                              <CircleOff size={15} />
                            )}
                            {statusLabel(status)}
                          </span>
                        </td>

                        <td>
                          <div className="designation-updated">
                            <strong>
                              {formatDateTime(row.updated_at || row.created_at)}
                            </strong>
                            <small>
                              {safeText(row.updated_by_name) ||
                                safeText(row.created_by_name) ||
                                'Updated by the system'}
                            </small>
                          </div>
                        </td>

                        <td>
                          <div className="designation-actions">
                            <button
                              type="button"
                              className="designation-action-button edit"
                              onClick={() => openEditForm(row)}
                            >
                              <Edit3 size={16} />
                              Edit
                            </button>

                            <button
                              type="button"
                              className="designation-action-button delete"
                              onClick={() => removeDesignation(row)}
                              disabled={deletingId === id}
                            >
                              {deletingId === id ? (
                                <RefreshCw size={16} className="is-spinning" />
                              ) : (
                                <Trash2 size={16} />
                              )}
                              {deletingId === id ? 'Removing…' : 'Remove'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="designation-mobile-list">
              {visibleRows.map((row, index) => {
                const id = recordId(row);
                const status = statusValue(row);
                const title = designationTitle(row);

                return (
                  <article
                    className="designation-mobile-card"
                    key={
                      id ||
                      `mobile-${designationName(row)}-${designationDepartment(row)}-${index}`
                    }
                  >
                    <div className="designation-mobile-top">
                      <div className="designation-mobile-title">
                        <span className="designation-name-icon">
                          <UserRoundCog size={20} />
                        </span>

                        <div>
                          <h3>{designationName(row)}</h3>
                          <p>{title || 'No separate short title'}</p>
                        </div>
                      </div>

                      <span className={`designation-status ${status}`}>
                        {status === 'active' ? (
                          <BadgeCheck size={15} />
                        ) : (
                          <CircleOff size={15} />
                        )}
                        {statusLabel(status)}
                      </span>
                    </div>

                    <div className="designation-mobile-meta">
                      <article>
                        <span>Department</span>
                        <strong>{designationDepartment(row)}</strong>
                      </article>

                      <article>
                        <span>Last updated</span>
                        <strong>
                          {formatDateTime(row.updated_at || row.created_at)}
                        </strong>
                      </article>
                    </div>

                    <div className="designation-mobile-bottom">
                      <small>
                        Updated by{' '}
                        {safeText(row.updated_by_name) ||
                          safeText(row.created_by_name) ||
                          'the system'}
                      </small>

                      <div className="designation-actions">
                        <button
                          type="button"
                          className="designation-action-button edit"
                          onClick={() => openEditForm(row)}
                        >
                          <Edit3 size={16} />
                          Edit
                        </button>

                        <button
                          type="button"
                          className="designation-action-button delete"
                          onClick={() => removeDesignation(row)}
                          disabled={deletingId === id}
                        >
                          {deletingId === id ? (
                            <RefreshCw size={16} className="is-spinning" />
                          ) : (
                            <Trash2 size={16} />
                          )}
                          {deletingId === id ? 'Removing…' : 'Remove'}
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        ) : (
          <div className="designation-empty">
            <BriefcaseBusiness size={44} />
            <h3>No designations found</h3>
            <p>
              No designation matches the current search and filters. Clear the
              filters or create a new designation.
            </p>

            <button
              type="button"
              className="designation-primary-button"
              onClick={openCreateForm}
            >
              <Plus size={17} />
              Add Designation
            </button>
          </div>
        )}

        <footer className="designation-pagination">
          <p>
            Page {page} of {pageCount} • {total.toLocaleString('en-IN')} total
            designation{total === 1 ? '' : 's'}
          </p>

          <div className="designation-pagination-controls">
            <button
              type="button"
              className="designation-page-button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1 || loading}
              aria-label="Previous page"
            >
              <ChevronLeft size={19} />
            </button>

            <span className="designation-page-indicator">
              {page} / {pageCount}
            </span>

            <button
              type="button"
              className="designation-page-button"
              onClick={() =>
                setPage((current) => Math.min(pageCount, current + 1))
              }
              disabled={page >= pageCount || loading}
              aria-label="Next page"
            >
              <ChevronRight size={19} />
            </button>
          </div>
        </footer>
      </section>

      <DesignationFormModal
        open={formOpen}
        editing={Boolean(editingRow)}
        form={form}
        departments={departments}
        saving={saving}
        error={formError}
        onChange={updateForm}
        onClose={closeForm}
        onSubmit={submitDesignation}
      />
    </section>
  );
}