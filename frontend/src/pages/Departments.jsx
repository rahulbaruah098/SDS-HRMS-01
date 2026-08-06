import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BadgeCheck,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleOff,
  Edit3,
  FolderKanban,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';

import {
  createCollectionItem,
  deleteCollectionItem,
  listCollection,
  updateCollectionItem,
} from '../api/client';

const PAGE_SIZE = 100;

const EMPTY_FORM = {
  name: '',
  code: '',
  status: 'active',
};

function safeText(value = '') {
  return String(value ?? '').trim();
}

function departmentName(row = {}) {
  return (
    safeText(row.name) ||
    safeText(row.department_name) ||
    'Unnamed Department'
  );
}

function departmentCode(row = {}) {
  return safeText(row.code).toUpperCase();
}

function statusValue(row = {}) {
  const value = safeText(row.status).toLowerCase();
  return value || 'active';
}

function statusLabel(value = '') {
  const status = safeText(value).toLowerCase();

  if (status === 'inactive') {
    return 'Inactive';
  }

  return 'Active';
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

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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

function DepartmentFormModal({
  open,
  editing,
  form,
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
      className="department-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) {
          onClose();
        }
      }}
    >
      <section
        className="department-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="department-form-title"
      >
        <header className="department-modal-header">
          <div>
            <span className="department-eyebrow">
              <Building2 size={16} />
              Department master
            </span>

            <h2 id="department-form-title">
              {editing ? 'Edit Department' : 'Create Department'}
            </h2>

            <p>
              {editing
                ? 'Update the department name, code or active status.'
                : 'Add a department that can be used in employee, attendance, leave, project and reporting workflows.'}
            </p>
          </div>

          <button
            type="button"
            className="department-icon-button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close department form"
          >
            <X size={20} />
          </button>
        </header>

        <form className="department-form" onSubmit={onSubmit}>
          <div className="department-field">
            <label htmlFor="department-name">
              Department name <span>*</span>
            </label>

            <input
              id="department-name"
              autoFocus
              value={form.name}
              onChange={(event) => onChange('name', event.target.value)}
              placeholder="Example: Human Resources"
              maxLength={120}
              required
            />

            <small>
              This name will be available in employee, attendance, leave and
              project forms.
            </small>
          </div>

          <div className="department-field">
            <label htmlFor="department-code">Department code</label>

            <input
              id="department-code"
              value={form.code}
              onChange={(event) =>
                onChange(
                  'code',
                  event.target.value
                    .replace(/[^a-zA-Z0-9_-]/g, '')
                    .toUpperCase(),
                )
              }
              placeholder="Example: HR"
              maxLength={20}
            />

            <small>
              Use a short unique code. Letters, numbers, hyphens and underscores
              are accepted.
            </small>
          </div>

          <div className="department-field">
            <label htmlFor="department-status">Status</label>

            <select
              id="department-status"
              value={form.status}
              onChange={(event) => onChange('status', event.target.value)}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>

            <small>
              Inactive departments remain in historical records but should not be
              used for new employee assignments.
            </small>
          </div>

          {error ? <div className="department-form-error">{error}</div> : null}

          <footer className="department-modal-footer">
            <button
              type="button"
              className="department-secondary-button"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="department-primary-button"
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
                  Create Department
                </>
              )}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export default function Departments() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
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

  const loadDepartments = useCallback(
    async ({ silent = false } = {}) => {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setPageError('');

      try {
        const data = await listCollection('departments', {
          page,
          limit: PAGE_SIZE,
          q: appliedSearch,
          sort_by: 'name',
          sort_dir: 'asc',
        });

        setRows(Array.isArray(data.items) ? data.items : []);
        setTotal(Number(data.total || 0));
      } catch (error) {
        setRows([]);
        setTotal(0);
        setPageError(
          error?.message ||
            'Departments could not be loaded. Please check your access and try again.',
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [appliedSearch, page],
  );

  useEffect(() => {
    loadDepartments();
  }, [loadDepartments]);

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

  const visibleRows = useMemo(() => {
    if (!statusFilter) {
      return rows;
    }

    return rows.filter((row) => statusValue(row) === statusFilter);
  }, [rows, statusFilter]);

  const activeCount = useMemo(
    () => rows.filter((row) => statusValue(row) === 'active').length,
    [rows],
  );

  const inactiveCount = useMemo(
    () => rows.filter((row) => statusValue(row) === 'inactive').length,
    [rows],
  );

  const codedCount = useMemo(
    () => rows.filter((row) => Boolean(departmentCode(row))).length,
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
    setEditingRow(row);
    setForm({
      name: departmentName(row) === 'Unnamed Department' ? '' : departmentName(row),
      code: departmentCode(row),
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
    setStatusFilter('');
    setPage(1);
  }

  async function submitDepartment(event) {
    event.preventDefault();

    const name = safeText(form.name);
    const code = safeText(form.code).toUpperCase();
    const status = safeText(form.status).toLowerCase() || 'active';

    if (!name) {
      setFormError('Department name is required.');
      return;
    }

    const payload = {
      name,
      department_name: name,
      code,
      status,
    };

    setSaving(true);
    setFormError('');
    setMessage('');

    try {
      if (editingRow) {
        const id = recordId(editingRow);

        if (!id) {
          throw new Error('This department cannot be updated because its internal reference is missing.');
        }

        const response = await updateCollectionItem(
          'departments',
          id,
          payload,
        );

        setMessage(response?.message || 'Department updated successfully.');
      } else {
        const response = await createCollectionItem('departments', payload);
        setMessage(response?.message || 'Department created successfully.');
      }

      closeForm();
      await loadDepartments({ silent: true });
    } catch (error) {
      setFormError(
        error?.message ||
          `Unable to ${editingRow ? 'update' : 'create'} the department.`,
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeDepartment(row) {
    const id = recordId(row);
    const name = departmentName(row);

    if (!id) {
      setPageError('This department cannot be removed because its internal reference is missing.');
      return;
    }

    const confirmed = window.confirm(
      `Remove "${name}"?\n\nThe department will become inactive and remain available in historical records.`,
    );

    if (!confirmed) {
      return;
    }

    setDeletingId(id);
    setPageError('');
    setMessage('');

    try {
      const response = await deleteCollectionItem('departments', id);
      setMessage(response?.message || 'Department removed successfully.');

      if (visibleRows.length === 1 && page > 1) {
        setPage((current) => Math.max(1, current - 1));
      } else {
        await loadDepartments({ silent: true });
      }
    } catch (error) {
      setPageError(error?.message || 'Unable to remove the department.');
    } finally {
      setDeletingId('');
    }
  }

  const hasFilters = Boolean(appliedSearch || statusFilter);

  return (
    <section className="departments-page">
      <style>{`
        .departments-page {
          --department-ink: #11182d;
          --department-muted: #66748d;
          --department-border: rgba(133, 149, 187, .28);
          --department-primary: #4f46ef;
          display: grid;
          gap: 20px;
          width: 100%;
          padding-bottom: 34px;
          color: var(--department-ink);
        }

        .department-hero,
        .department-panel {
          border: 1px solid var(--department-border);
          border-radius: 30px;
          background: rgba(255, 255, 255, .91);
          box-shadow: 0 20px 55px rgba(38, 52, 88, .09);
          backdrop-filter: blur(16px);
        }

        .department-hero {
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
            radial-gradient(circle at 94% 8%, rgba(46, 210, 171, .18), transparent 31%),
            linear-gradient(125deg, rgba(255, 255, 255, .97), rgba(247, 250, 255, .94));
        }

        .department-hero::after {
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

        .department-hero-copy {
          position: relative;
          z-index: 1;
          max-width: 800px;
        }

        .department-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: var(--department-primary);
          font-size: 12px;
          font-weight: 900;
          letter-spacing: .1em;
          text-transform: uppercase;
        }

        .department-hero h1 {
          margin: 11px 0 8px;
          font-size: clamp(32px, 4vw, 49px);
          line-height: 1.03;
          letter-spacing: -.04em;
        }

        .department-hero p {
          max-width: 760px;
          margin: 0;
          color: var(--department-muted);
          font-size: 16px;
          line-height: 1.7;
        }

        .department-primary-button,
        .department-secondary-button,
        .department-icon-button,
        .department-action-button,
        .department-page-button {
          border: 0;
          font: inherit;
          cursor: pointer;
          transition:
            transform .18s ease,
            box-shadow .18s ease,
            background .18s ease,
            border-color .18s ease;
        }

        .department-primary-button,
        .department-secondary-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-height: 47px;
          padding: 0 18px;
          border-radius: 14px;
          font-weight: 850;
        }

        .department-primary-button {
          position: relative;
          z-index: 1;
          flex: 0 0 auto;
          background: linear-gradient(135deg, #5147f4, #6b5df8);
          color: #fff;
          box-shadow: 0 14px 29px rgba(79, 70, 239, .25);
        }

        .department-secondary-button {
          border: 1px solid rgba(133, 149, 187, .32);
          background: #fff;
          color: #344054;
        }

        .department-primary-button:hover:not(:disabled),
        .department-secondary-button:hover:not(:disabled),
        .department-action-button:hover:not(:disabled),
        .department-page-button:hover:not(:disabled),
        .department-icon-button:hover:not(:disabled) {
          transform: translateY(-2px);
        }

        .department-primary-button:disabled,
        .department-secondary-button:disabled,
        .department-action-button:disabled,
        .department-page-button:disabled,
        .department-icon-button:disabled {
          cursor: not-allowed;
          opacity: .55;
        }

        .is-spinning {
          animation: department-spin .8s linear infinite;
        }

        @keyframes department-spin {
          to { transform: rotate(360deg); }
        }

        .department-kpi-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
        }

        .department-kpi {
          display: flex;
          align-items: center;
          gap: 14px;
          min-height: 108px;
          padding: 20px;
          border: 1px solid var(--department-border);
          border-radius: 22px;
          background: rgba(255, 255, 255, .92);
          box-shadow: 0 13px 34px rgba(38, 52, 88, .07);
        }

        .department-kpi-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 46px;
          height: 46px;
          flex: 0 0 46px;
          border-radius: 15px;
          background: rgba(79, 70, 239, .09);
          color: var(--department-primary);
        }

        .department-kpi span {
          display: block;
          color: var(--department-muted);
          font-size: 11px;
          font-weight: 900;
          letter-spacing: .055em;
          text-transform: uppercase;
        }

        .department-kpi strong {
          display: block;
          margin-top: 5px;
          font-size: 24px;
          line-height: 1.1;
        }

        .department-kpi small {
          display: block;
          margin-top: 5px;
          color: #8791a7;
          line-height: 1.35;
        }

        .department-panel {
          overflow: hidden;
        }

        .department-toolbar {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 18px;
          padding: 24px 26px 18px;
        }

        .department-toolbar-heading {
          display: flex;
          align-items: center;
          gap: 11px;
        }

        .department-toolbar-heading h2 {
          margin: 0;
          font-size: 21px;
        }

        .department-toolbar-heading p {
          margin: 4px 0 0;
          color: var(--department-muted);
          font-size: 13px;
        }

        .department-toolbar-actions {
          display: flex;
          align-items: center;
          gap: 9px;
        }

        .department-search-row {
          display: grid;
          grid-template-columns: minmax(260px, 1fr) minmax(180px, 260px) auto;
          gap: 12px;
          padding: 0 26px 24px;
        }

        .department-field {
          display: grid;
          gap: 7px;
        }

        .department-field label {
          color: #46536b;
          font-size: 12px;
          font-weight: 850;
        }

        .department-field label span {
          color: #dc2626;
        }

        .department-input-wrap {
          position: relative;
        }

        .department-input-wrap > svg {
          position: absolute;
          top: 50%;
          left: 14px;
          transform: translateY(-50%);
          color: #78839c;
          pointer-events: none;
        }

        .department-field input,
        .department-field select {
          width: 100%;
          min-height: 46px;
          border: 1px solid rgba(133, 149, 187, .36);
          border-radius: 14px;
          outline: none;
          background: rgba(248, 250, 255, .88);
          color: var(--department-ink);
          font: inherit;
          padding: 0 14px;
          transition:
            border-color .18s ease,
            box-shadow .18s ease,
            background .18s ease;
        }

        .department-input-wrap input {
          padding-left: 43px;
        }

        .department-field input:focus,
        .department-field select:focus {
          border-color: rgba(79, 70, 239, .58);
          background: #fff;
          box-shadow: 0 0 0 4px rgba(79, 70, 239, .09);
        }

        .department-field small {
          color: var(--department-muted);
          font-size: 12px;
          line-height: 1.45;
        }

        .department-feedback {
          margin: 0 26px 20px;
          padding: 14px 16px;
          border-radius: 15px;
          font-weight: 750;
        }

        .department-feedback.success {
          border: 1px solid rgba(16, 185, 129, .22);
          background: rgba(209, 250, 229, .58);
          color: #08775c;
        }

        .department-feedback.error {
          border: 1px solid rgba(220, 38, 38, .2);
          background: rgba(254, 226, 226, .62);
          color: #ac2029;
        }

        .department-table-wrap {
          overflow-x: auto;
          border-top: 1px solid rgba(133, 149, 187, .2);
          -webkit-overflow-scrolling: touch;
        }

        .department-table {
          width: 100%;
          min-width: 800px;
          border-collapse: collapse;
        }

        .department-table th {
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

        .department-table td {
          padding: 17px 18px;
          border-top: 1px solid rgba(133, 149, 187, .15);
          vertical-align: middle;
        }

        .department-table tbody tr {
          transition: background .18s ease;
        }

        .department-table tbody tr:hover {
          background: rgba(79, 70, 239, .035);
        }

        .department-name-cell {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 245px;
        }

        .department-name-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 41px;
          height: 41px;
          flex: 0 0 41px;
          border-radius: 13px;
          background: rgba(79, 70, 239, .085);
          color: #4f46ef;
        }

        .department-name-cell strong,
        .department-code {
          display: block;
        }

        .department-name-cell small {
          display: block;
          margin-top: 4px;
          color: var(--department-muted);
        }

        .department-code {
          width: fit-content;
          min-width: 48px;
          padding: 7px 10px;
          border-radius: 10px;
          background: rgba(59, 130, 246, .09);
          color: #285f9f;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: .045em;
          white-space: nowrap;
        }

        .department-code.empty {
          background: rgba(100, 116, 139, .08);
          color: #6b7280;
          font-weight: 750;
          letter-spacing: normal;
        }

        .department-status {
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

        .department-status.active {
          background: rgba(16, 185, 129, .11);
          color: #08775c;
        }

        .department-status.inactive {
          background: rgba(100, 116, 139, .11);
          color: #596579;
        }

        .department-updated {
          display: grid;
          gap: 4px;
          min-width: 170px;
        }

        .department-updated small {
          color: var(--department-muted);
        }

        .department-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          white-space: nowrap;
        }

        .department-action-button {
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

        .department-action-button.edit {
          border-color: rgba(79, 70, 239, .23);
          background: rgba(79, 70, 239, .055);
          color: #433bb8;
        }

        .department-action-button.delete {
          border-color: rgba(220, 38, 38, .18);
          background: rgba(254, 226, 226, .45);
          color: #b4232c;
        }

        .department-loading {
          display: grid;
          gap: 11px;
          padding: 28px 26px;
          border-top: 1px solid rgba(133, 149, 187, .18);
        }

        .department-loading span {
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
          animation: department-skeleton 1.25s linear infinite;
        }

        @keyframes department-skeleton {
          to { background-position: -220% 0; }
        }

        .department-empty {
          display: grid;
          justify-items: center;
          gap: 10px;
          padding: 50px 22px;
          border-top: 1px solid rgba(133, 149, 187, .18);
          color: var(--department-muted);
          text-align: center;
        }

        .department-empty svg {
          color: #7066df;
        }

        .department-empty h3 {
          margin: 0;
          color: var(--department-ink);
        }

        .department-empty p {
          max-width: 540px;
          margin: 0;
          line-height: 1.6;
        }

        .department-mobile-list {
          display: none;
          gap: 12px;
          padding: 16px;
          border-top: 1px solid rgba(133, 149, 187, .18);
        }

        .department-mobile-card {
          display: grid;
          gap: 14px;
          padding: 17px;
          border: 1px solid rgba(133, 149, 187, .23);
          border-radius: 18px;
          background: rgba(255, 255, 255, .98);
          box-shadow: 0 10px 26px rgba(38, 52, 88, .06);
        }

        .department-mobile-top,
        .department-mobile-bottom {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
        }

        .department-mobile-title {
          display: flex;
          align-items: center;
          gap: 11px;
          min-width: 0;
        }

        .department-mobile-title > div:last-child {
          min-width: 0;
        }

        .department-mobile-title h3 {
          margin: 0;
          overflow-wrap: anywhere;
          font-size: 17px;
        }

        .department-mobile-title p {
          margin: 4px 0 0;
          color: var(--department-muted);
          font-size: 13px;
        }

        .department-mobile-meta {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }

        .department-mobile-meta article {
          padding: 11px;
          border-radius: 13px;
          background: rgba(247, 248, 253, .92);
        }

        .department-mobile-meta span {
          display: block;
          color: var(--department-muted);
          font-size: 11px;
          font-weight: 850;
          text-transform: uppercase;
        }

        .department-mobile-meta strong {
          display: block;
          margin-top: 5px;
          overflow-wrap: anywhere;
          font-size: 13px;
        }

        .department-pagination {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 18px 24px;
          border-top: 1px solid rgba(133, 149, 187, .18);
        }

        .department-pagination p {
          margin: 0;
          color: var(--department-muted);
          font-size: 13px;
        }

        .department-pagination-controls {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .department-page-button {
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

        .department-page-indicator {
          min-width: 88px;
          text-align: center;
          color: #3d4960;
          font-size: 13px;
          font-weight: 800;
        }

        .department-modal-backdrop {
          position: fixed;
          z-index: 2600;
          inset: 0;
          display: grid;
          place-items: center;
          padding: 22px;
          background: rgba(14, 22, 42, .56);
          backdrop-filter: blur(8px);
        }

        .department-modal {
          width: min(620px, 100%);
          max-height: 92vh;
          overflow-y: auto;
          border: 1px solid rgba(255, 255, 255, .45);
          border-radius: 28px;
          background: #fff;
          box-shadow: 0 34px 90px rgba(9, 16, 35, .3);
          animation: department-modal-enter .2s ease-out;
        }

        @keyframes department-modal-enter {
          from {
            opacity: 0;
            transform: translateY(12px) scale(.985);
          }

          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        .department-modal-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 20px;
          padding: 27px 28px 22px;
          border-bottom: 1px solid rgba(133, 149, 187, .18);
          background:
            radial-gradient(circle at 92% 0%, rgba(55, 210, 174, .15), transparent 35%),
            radial-gradient(circle at 5% 0%, rgba(99, 88, 245, .14), transparent 39%),
            #fff;
        }

        .department-modal-header h2 {
          margin: 8px 0 6px;
          font-size: 28px;
          letter-spacing: -.025em;
        }

        .department-modal-header p {
          max-width: 490px;
          margin: 0;
          color: var(--department-muted);
          line-height: 1.55;
        }

        .department-icon-button {
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

        .department-form {
          display: grid;
          gap: 18px;
          padding: 24px 28px 28px;
        }

        .department-form-error {
          padding: 14px 15px;
          border: 1px solid rgba(220, 38, 38, .2);
          border-radius: 14px;
          background: rgba(254, 226, 226, .6);
          color: #a91e28;
          font-weight: 750;
        }

        .department-modal-footer {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          padding-top: 4px;
        }

        @media (max-width: 1050px) {
          .department-kpi-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 820px) {
          .department-table-wrap {
            display: none;
          }

          .department-mobile-list {
            display: grid;
          }

          .department-search-row {
            grid-template-columns: 1fr 1fr;
          }

          .department-search-row > button {
            grid-column: 1 / -1;
          }
        }

        @media (max-width: 640px) {
          .departments-page {
            gap: 16px;
          }

          .department-hero {
            align-items: flex-start;
            flex-direction: column;
            min-height: auto;
            padding: 25px 21px;
            border-radius: 24px;
          }

          .department-hero .department-primary-button {
            width: 100%;
          }

          .department-kpi-grid {
            grid-template-columns: 1fr;
          }

          .department-kpi {
            min-height: 92px;
          }

          .department-toolbar {
            align-items: flex-start;
            flex-direction: column;
            padding: 21px 18px 16px;
          }

          .department-toolbar-actions {
            width: 100%;
          }

          .department-toolbar-actions .department-secondary-button {
            width: 100%;
          }

          .department-search-row {
            grid-template-columns: 1fr;
            padding: 0 18px 20px;
          }

          .department-search-row > button {
            grid-column: auto;
            width: 100%;
          }

          .department-feedback {
            margin-left: 18px;
            margin-right: 18px;
          }

          .department-mobile-list {
            padding-left: 12px;
            padding-right: 12px;
          }

          .department-mobile-bottom {
            flex-direction: column;
          }

          .department-actions {
            width: 100%;
          }

          .department-actions .department-action-button {
            flex: 1 1 0;
          }

          .department-pagination {
            align-items: flex-start;
            flex-direction: column;
          }

          .department-pagination-controls {
            width: 100%;
            justify-content: space-between;
          }

          .department-modal-backdrop {
            align-items: end;
            padding: 0;
          }

          .department-modal {
            width: 100%;
            max-height: 94vh;
            border-radius: 25px 25px 0 0;
          }

          .department-modal-header,
          .department-form {
            padding-left: 19px;
            padding-right: 19px;
          }

          .department-modal-footer {
            flex-direction: column-reverse;
          }

          .department-modal-footer button {
            width: 100%;
          }
        }

        @media (max-width: 430px) {
          .department-mobile-top {
            flex-direction: column;
          }

          .department-mobile-meta {
            grid-template-columns: 1fr;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .departments-page *,
          .departments-page *::before,
          .departments-page *::after {
            animation-duration: .01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: .01ms !important;
          }
        }


        /* YourComate reference-design overrides */
        .departments-page {
          --department-ink: #101a3a;
          --department-muted: #596483;
          --department-primary: #6254da;
          --department-deep: #342b78;
          --department-blue: #3766db;
          --department-teal: #18aaa8;
          --department-flat-blue: #b9d7ff;
          --department-flat-violet: #c9c0ff;
          --department-flat-teal: #aee6d9;
          --department-ease: cubic-bezier(.22, 1, .36, 1);
          gap: 22px;
          min-width: 0;
          padding-bottom: max(34px, env(safe-area-inset-bottom));
          color: var(--department-ink);
          font-family: var(--yc-ui, var(--body), inherit);
        }

        .department-hero {
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
            12px 14px 0 var(--department-flat-blue),
            0 28px 48px rgba(34, 38, 110, .13);
        }

        .department-hero::before {
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

        .department-hero::after {
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

        .department-hero-copy {
          max-width: 840px;
          min-width: 0;
        }

        .department-eyebrow {
          width: fit-content;
          padding: 9px 13px;
          border-radius: 999px;
          color: #fff;
          background: var(--department-deep);
          font-size: 9px;
          line-height: 1;
          letter-spacing: .12em;
        }

        .department-hero h1 {
          margin: 15px 0 10px;
          color: var(--department-ink);
          font-family: var(--yc-display, var(--heading), inherit);
          font-size: clamp(34px, 4.4vw, 66px);
          font-weight: 760;
          line-height: .94;
          letter-spacing: -.055em;
        }

        .department-hero p {
          max-width: 790px;
          color: var(--department-muted);
          font-size: clamp(13px, 1vw, 16px);
          line-height: 1.68;
        }

        .department-primary-button,
        .department-secondary-button,
        .department-icon-button,
        .department-action-button,
        .department-page-button {
          touch-action: manipulation;
          font-weight: 900;
          transition:
            transform 240ms var(--department-ease),
            box-shadow 240ms var(--department-ease),
            border-color 200ms ease,
            background 200ms ease,
            color 200ms ease,
            filter 200ms ease;
        }

        .department-primary-button {
          border: 1px solid rgba(52, 43, 120, .16);
          background: linear-gradient(145deg, #4f72df, #2bb9b5);
          box-shadow:
            5px 6px 0 rgba(52, 43, 120, .8),
            0 12px 22px rgba(55, 102, 219, .16);
        }

        .department-secondary-button {
          border-color: rgba(98, 84, 218, .18);
          color: var(--department-deep);
          background: #f1efff;
          box-shadow: 4px 5px 0 rgba(98, 84, 218, .14);
        }

        .department-primary-button:hover:not(:disabled),
        .department-secondary-button:hover:not(:disabled),
        .department-action-button:hover:not(:disabled),
        .department-page-button:hover:not(:disabled),
        .department-icon-button:hover:not(:disabled) {
          transform: translateY(-2px);
          filter: saturate(1.04);
        }

        .department-primary-button:active:not(:disabled),
        .department-secondary-button:active:not(:disabled),
        .department-action-button:active:not(:disabled),
        .department-page-button:active:not(:disabled),
        .department-icon-button:active:not(:disabled) {
          transform: translateY(0) scale(.985);
        }

        .department-kpi-grid {
          gap: 16px;
        }

        .department-kpi {
          min-width: 0;
          min-height: 112px;
          padding: 19px;
          border-color: rgba(171, 181, 211, .68);
          border-radius: 22px;
          background: #f8fbff;
          box-shadow:
            7px 9px 0 var(--department-flat-blue),
            0 18px 30px rgba(15, 20, 75, .08);
          transition:
            transform 260ms var(--department-ease),
            border-color 220ms ease,
            box-shadow 260ms var(--department-ease);
        }

        .department-kpi:nth-child(2) {
          background: #eaf8f4;
          box-shadow:
            7px 9px 0 var(--department-flat-teal),
            0 18px 30px rgba(15, 20, 75, .08);
        }

        .department-kpi:nth-child(3) {
          background: #f1efff;
          box-shadow:
            7px 9px 0 var(--department-flat-violet),
            0 18px 30px rgba(15, 20, 75, .08);
        }

        .department-kpi:nth-child(4) {
          background: #fff4d5;
          box-shadow:
            7px 9px 0 #ffe0a5,
            0 18px 30px rgba(15, 20, 75, .08);
        }

        .department-kpi:hover {
          transform: translateY(-3px);
          border-color: rgba(98, 84, 218, .3);
        }

        .department-kpi-icon,
        .department-name-icon {
          border: 1px solid rgba(52, 43, 120, .15);
          color: #fff;
          background: linear-gradient(145deg, #4f72df, #2bb9b5);
          box-shadow: 4px 5px 0 rgba(98, 84, 218, .16);
        }

        .department-kpi strong {
          color: var(--department-ink);
          font-family: var(--yc-display, var(--heading), inherit);
          font-size: 29px;
          letter-spacing: -.035em;
        }

        .department-kpi span,
        .department-kpi small {
          color: var(--department-muted);
        }

        .department-panel {
          min-width: 0;
          border-color: rgba(171, 181, 211, .72);
          border-radius: clamp(24px, 2vw, 32px);
          background: linear-gradient(145deg, rgba(255,255,255,.99), rgba(244,249,255,.98));
          box-shadow:
            9px 11px 0 #d1dcfa,
            0 24px 42px rgba(34, 38, 110, .1);
        }

        .department-toolbar {
          border-bottom: 1px solid rgba(65, 55, 161, .08);
          background: rgba(255, 255, 255, .64);
        }

        .department-toolbar-heading > svg {
          color: var(--department-primary);
        }

        .department-toolbar-heading h2 {
          color: var(--department-ink);
          font-family: var(--yc-display, var(--heading), inherit);
          font-size: clamp(22px, 2vw, 30px);
          font-weight: 760;
          line-height: 1;
          letter-spacing: -.03em;
        }

        .department-toolbar-heading p {
          color: var(--department-muted);
        }

        .department-search-row {
          background: linear-gradient(145deg, rgba(237,248,255,.44), rgba(248,241,255,.34));
        }

        .department-field label {
          color: #334164;
          font-weight: 900;
        }

        .department-input-wrap > svg {
          color: var(--department-primary);
        }

        .department-field input,
        .department-field select {
          border-color: rgba(159, 169, 205, .62);
          background: rgba(255, 255, 255, .88);
          color: var(--department-ink);
        }

        .department-field input:hover,
        .department-field select:hover {
          border-color: rgba(98, 84, 218, .34);
        }

        .department-field input:focus,
        .department-field select:focus {
          border-color: var(--department-primary);
          background: #fff;
          box-shadow: 0 0 0 4px rgba(98, 84, 218, .11);
        }

        .department-feedback {
          animation: departmentFeedbackEnter 360ms var(--department-ease) both;
        }

        @keyframes departmentFeedbackEnter {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .department-feedback.success {
          border-color: rgba(19, 115, 111, .2);
          color: #13736f;
          background: #dff8f3;
        }

        .department-feedback.error,
        .department-form-error {
          border-color: rgba(190, 47, 85, .18);
          color: #b62f55;
          background: #ffe4ec;
        }

        .department-table-wrap {
          border-top-color: rgba(65, 55, 161, .1);
          overscroll-behavior-x: contain;
          scrollbar-width: thin;
          scrollbar-color: rgba(98, 84, 218, .35) transparent;
        }

        .department-table-wrap::-webkit-scrollbar {
          height: 8px;
        }

        .department-table-wrap::-webkit-scrollbar-thumb {
          border-radius: 999px;
          background: rgba(98, 84, 218, .35);
        }

        .department-table th {
          position: sticky;
          top: 0;
          z-index: 2;
          border-bottom: 1px solid rgba(65, 55, 161, .11);
          color: #4f5e7f;
          background: rgba(241, 239, 255, .94);
          backdrop-filter: blur(12px);
          font-size: 10px;
        }

        .department-table td {
          border-top-color: rgba(65, 55, 161, .09);
          color: #334164;
          background: rgba(255, 255, 255, .62);
        }

        .department-table tbody tr:hover {
          background: transparent;
        }

        .department-table tbody tr:hover td {
          background: rgba(237, 246, 255, .82);
        }

        .department-name-cell strong {
          color: var(--department-ink);
          font-weight: 950;
        }

        .department-code {
          border-radius: 999px;
          color: #3657b5;
          background: #e5e9ff;
        }

        .department-code.empty {
          color: #5f6983;
          background: #edf0f6;
        }

        .department-status.active {
          color: #13736f;
          background: #dff8f3;
        }

        .department-status.inactive {
          color: #5f6983;
          background: #edf0f6;
        }

        .department-action-button.edit {
          border-color: rgba(98, 84, 218, .18);
          color: var(--department-deep);
          background: #f1efff;
          box-shadow: 3px 4px 0 rgba(98, 84, 218, .12);
        }

        .department-action-button.delete {
          border-color: rgba(190, 47, 85, .18);
          color: #b62f55;
          background: #ffe4ec;
        }

        .department-loading span {
          border: 1px solid rgba(171, 181, 211, .5);
          background:
            linear-gradient(90deg, #edf6ff 25%, #fff 37%, #f1efff 50%, #fff 63%, #edf6ff 75%);
          background-size: 400% 100%;
        }

        .department-empty {
          border-top-color: rgba(65, 55, 161, .1);
          background: linear-gradient(145deg, rgba(237,248,255,.58), rgba(248,241,255,.52));
        }

        .department-empty svg {
          color: var(--department-primary);
        }

        .department-mobile-card {
          border-color: rgba(171, 181, 211, .64);
          background: linear-gradient(145deg, rgba(255,255,255,.98), rgba(244,249,255,.94));
          box-shadow:
            5px 6px 0 rgba(185, 215, 255, .72),
            0 14px 24px rgba(34, 38, 110, .07);
          transition:
            transform 240ms var(--department-ease),
            border-color 200ms ease,
            box-shadow 240ms var(--department-ease);
        }

        .department-mobile-card:hover {
          transform: translateY(-2px);
          border-color: rgba(98, 84, 218, .3);
        }

        .department-mobile-meta article {
          border: 1px solid rgba(98, 84, 218, .08);
          background: rgba(241, 239, 255, .52);
        }

        .department-pagination {
          border-top-color: rgba(65, 55, 161, .1);
          background: rgba(255, 255, 255, .66);
        }

        .department-page-button {
          border-color: rgba(98, 84, 218, .18);
          color: var(--department-deep);
          background: #f1efff;
          box-shadow: 3px 4px 0 rgba(98, 84, 218, .12);
        }

        .department-modal-backdrop {
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
          animation: departmentBackdropEnter 260ms ease both;
        }

        @keyframes departmentBackdropEnter {
          from { opacity: 0; backdrop-filter: blur(0); }
          to { opacity: 1; backdrop-filter: blur(9px); }
        }

        .department-modal {
          width: min(640px, 100%);
          max-height: calc(100dvh - 28px);
          overscroll-behavior: contain;
          border-color: rgba(171, 181, 211, .72);
          background: linear-gradient(145deg, #fff 0%, #f4fbff 52%, #f8f1ff 100%);
          box-shadow:
            0 34px 90px rgba(34, 38, 110, .25),
            10px 12px 0 rgba(185, 215, 255, .5);
          animation: departmentModalEnter 420ms var(--department-ease) both;
          transform-origin: 50% 14%;
          -webkit-overflow-scrolling: touch;
        }

        @keyframes departmentModalEnter {
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

        .department-modal-header {
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

        .department-modal-header h2 {
          color: var(--department-ink);
          font-family: var(--yc-display, var(--heading), inherit);
          font-size: 29px;
          font-weight: 760;
          line-height: 1;
          letter-spacing: -.035em;
        }

        .department-icon-button {
          border: 1px solid rgba(98, 84, 218, .18);
          color: var(--department-deep);
          background: #f1efff;
          box-shadow: 4px 5px 0 rgba(98, 84, 218, .14);
        }

        .department-modal-footer {
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
          .department-hero {
            min-height: 245px;
          }
        }

        @media (max-width: 640px) {
          .department-hero {
            padding: 20px;
            box-shadow:
              7px 8px 0 var(--department-flat-blue),
              0 18px 30px rgba(34, 38, 110, .1);
          }

          .department-kpi-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
          }

          .department-kpi {
            min-height: 118px;
            padding: 14px;
            border-radius: 17px;
          }

          .department-panel {
            box-shadow:
              6px 7px 0 #d1dcfa,
              0 16px 28px rgba(34, 38, 110, .08);
          }

          .department-modal {
            max-height: calc(100dvh - max(8px, env(safe-area-inset-top)));
            box-shadow: 0 -18px 60px rgba(34, 38, 110, .24);
            animation-name: departmentMobileSheetEnter;
            transform-origin: 50% 100%;
          }

          @keyframes departmentMobileSheetEnter {
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
          .department-kpi-grid {
            grid-template-columns: 1fr;
          }

          .department-kpi {
            min-height: auto;
          }
        }

      `}</style>

      <header className="department-hero">
        <div className="department-hero-copy">
          <span className="department-eyebrow">
            <ShieldCheck size={17} />
            Employee setup
          </span>

          <h1>Departments</h1>

          <p>
            Build and maintain the department structure used throughout employee
            records, attendance, leave, projects, payroll and reports. Internal
            database IDs are intentionally hidden.
          </p>
        </div>

        <button
          type="button"
          className="department-primary-button"
          onClick={openCreateForm}
        >
          <Plus size={18} />
          Add Department
        </button>
      </header>

      <div className="department-kpi-grid">
        <article className="department-kpi">
          <span className="department-kpi-icon">
            <Building2 size={22} />
          </span>

          <div>
            <span>Total departments</span>
            <strong>{total.toLocaleString('en-IN')}</strong>
            <small>Available in your company scope</small>
          </div>
        </article>

        <article className="department-kpi">
          <span className="department-kpi-icon">
            <CheckCircle2 size={22} />
          </span>

          <div>
            <span>Active on page</span>
            <strong>{activeCount.toLocaleString('en-IN')}</strong>
            <small>Available for employee assignment</small>
          </div>
        </article>

        <article className="department-kpi">
          <span className="department-kpi-icon">
            <CircleOff size={22} />
          </span>

          <div>
            <span>Inactive on page</span>
            <strong>{inactiveCount.toLocaleString('en-IN')}</strong>
            <small>Retained for historical records</small>
          </div>
        </article>

        <article className="department-kpi">
          <span className="department-kpi-icon">
            <FolderKanban size={22} />
          </span>

          <div>
            <span>Codes assigned</span>
            <strong>{codedCount.toLocaleString('en-IN')}</strong>
            <small>Departments with a short code</small>
          </div>
        </article>
      </div>

      <section className="department-panel">
        <div className="department-toolbar">
          <div className="department-toolbar-heading">
            <Activity size={21} />

            <div>
              <h2>Department directory</h2>
              <p>
                Search, create, edit or safely deactivate departments without
                exposing internal IDs.
              </p>
            </div>
          </div>

          <div className="department-toolbar-actions">
            <button
              type="button"
              className="department-secondary-button"
              onClick={() => loadDepartments({ silent: true })}
              disabled={refreshing}
            >
              <RefreshCw
                size={17}
                className={refreshing ? 'is-spinning' : ''}
              />
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        <form className="department-search-row" onSubmit={applySearch}>
          <div className="department-field">
            <label htmlFor="department-search">Search departments</label>

            <div className="department-input-wrap">
              <Search size={18} />

              <input
                id="department-search"
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Department name or code"
              />
            </div>
          </div>

          <div className="department-field">
            <label htmlFor="department-status-filter">Status</label>

            <select
              id="department-status-filter"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="">All statuses</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </select>
          </div>

          <button type="submit" className="department-primary-button">
            <Search size={17} />
            Search
          </button>
        </form>

        {hasFilters ? (
          <div style={{ padding: '0 26px 18px' }}>
            <button
              type="button"
              className="department-secondary-button"
              onClick={clearFilters}
            >
              <X size={17} />
              Clear Filters
            </button>
          </div>
        ) : null}

        {message ? (
          <div className="department-feedback success">{message}</div>
        ) : null}

        {pageError ? (
          <div className="department-feedback error">{pageError}</div>
        ) : null}

        {loading ? (
          <div className="department-loading" aria-label="Loading departments">
            <span />
            <span />
            <span />
            <span />
          </div>
        ) : visibleRows.length > 0 ? (
          <>
            <div className="department-table-wrap">
              <table className="department-table">
                <thead>
                  <tr>
                    <th>Department</th>
                    <th>Code</th>
                    <th>Status</th>
                    <th>Last updated</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {visibleRows.map((row, index) => {
                    const id = recordId(row);
                    const code = departmentCode(row);
                    const status = statusValue(row);

                    return (
                      <tr
                        key={
                          id ||
                          `${departmentName(row)}-${code || 'no-code'}-${index}`
                        }
                      >
                        <td>
                          <div className="department-name-cell">
                            <span className="department-name-icon">
                              <Building2 size={19} />
                            </span>

                            <div>
                              <strong>{departmentName(row)}</strong>
                              <small>Department master record</small>
                            </div>
                          </div>
                        </td>

                        <td>
                          <span
                            className={`department-code ${code ? '' : 'empty'}`}
                          >
                            {code || 'Not assigned'}
                          </span>
                        </td>

                        <td>
                          <span className={`department-status ${status}`}>
                            {status === 'active' ? (
                              <BadgeCheck size={15} />
                            ) : (
                              <CircleOff size={15} />
                            )}
                            {statusLabel(status)}
                          </span>
                        </td>

                        <td>
                          <div className="department-updated">
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
                          <div className="department-actions">
                            <button
                              type="button"
                              className="department-action-button edit"
                              onClick={() => openEditForm(row)}
                            >
                              <Edit3 size={16} />
                              Edit
                            </button>

                            <button
                              type="button"
                              className="department-action-button delete"
                              onClick={() => removeDepartment(row)}
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

            <div className="department-mobile-list">
              {visibleRows.map((row, index) => {
                const id = recordId(row);
                const code = departmentCode(row);
                const status = statusValue(row);

                return (
                  <article
                    className="department-mobile-card"
                    key={
                      id ||
                      `mobile-${departmentName(row)}-${code || 'no-code'}-${index}`
                    }
                  >
                    <div className="department-mobile-top">
                      <div className="department-mobile-title">
                        <span className="department-name-icon">
                          <Building2 size={19} />
                        </span>

                        <div>
                          <h3>{departmentName(row)}</h3>
                          <p>{code || 'No department code assigned'}</p>
                        </div>
                      </div>

                      <span className={`department-status ${status}`}>
                        {status === 'active' ? (
                          <BadgeCheck size={15} />
                        ) : (
                          <CircleOff size={15} />
                        )}
                        {statusLabel(status)}
                      </span>
                    </div>

                    <div className="department-mobile-meta">
                      <article>
                        <span>Department code</span>
                        <strong>{code || 'Not assigned'}</strong>
                      </article>

                      <article>
                        <span>Last updated</span>
                        <strong>
                          {formatDateTime(row.updated_at || row.created_at)}
                        </strong>
                      </article>
                    </div>

                    <div className="department-mobile-bottom">
                      <small>
                        Updated by{' '}
                        {safeText(row.updated_by_name) ||
                          safeText(row.created_by_name) ||
                          'the system'}
                      </small>

                      <div className="department-actions">
                        <button
                          type="button"
                          className="department-action-button edit"
                          onClick={() => openEditForm(row)}
                        >
                          <Edit3 size={16} />
                          Edit
                        </button>

                        <button
                          type="button"
                          className="department-action-button delete"
                          onClick={() => removeDepartment(row)}
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
          <div className="department-empty">
            <Building2 size={44} />
            <h3>No departments found</h3>
            <p>
              No department matches the current search and status filter. Clear
              the filters or create a new department.
            </p>

            <button
              type="button"
              className="department-primary-button"
              onClick={openCreateForm}
            >
              <Plus size={17} />
              Add Department
            </button>
          </div>
        )}

        <footer className="department-pagination">
          <p>
            Page {page} of {pageCount} • {total.toLocaleString('en-IN')} total
            department{total === 1 ? '' : 's'}
          </p>

          <div className="department-pagination-controls">
            <button
              type="button"
              className="department-page-button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1 || loading}
              aria-label="Previous page"
            >
              <ChevronLeft size={19} />
            </button>

            <span className="department-page-indicator">
              {page} / {pageCount}
            </span>

            <button
              type="button"
              className="department-page-button"
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

      <DepartmentFormModal
        open={formOpen}
        editing={Boolean(editingRow)}
        form={form}
        saving={saving}
        error={formError}
        onChange={updateForm}
        onClose={closeForm}
        onSubmit={submitDepartment}
      />
    </section>
  );
}