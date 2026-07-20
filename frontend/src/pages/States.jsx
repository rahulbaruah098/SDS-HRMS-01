import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  CircleOff,
  Edit3,
  Globe2,
  Map,
  MapPin,
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

function stateName(row = {}) {
  return safeText(row.name) || safeText(row.state_name) || 'Unnamed State';
}

function stateCode(row = {}) {
  return safeText(row.code || row.state_code).toUpperCase();
}

function statusValue(row = {}) {
  const value = safeText(row.status).toLowerCase();
  return value || 'active';
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

function StateFormModal({
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
      className="state-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) {
          onClose();
        }
      }}
    >
      <section
        className="state-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="state-form-title"
      >
        <header className="state-modal-header">
          <div>
            <span className="state-eyebrow">
              <MapPin size={16} />
              State master
            </span>

            <h2 id="state-form-title">
              {editing ? 'Edit State' : 'Create State'}
            </h2>

            <p>
              {editing
                ? 'Update the operating-state name, code or availability.'
                : 'Add an operating state used in employee records, attendance, holidays, branches and payroll configuration.'}
            </p>
          </div>

          <button
            type="button"
            className="state-icon-button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close state form"
          >
            <X size={20} />
          </button>
        </header>

        <form className="state-form" onSubmit={onSubmit}>
          <div className="state-field">
            <label htmlFor="state-name">
              State name <span>*</span>
            </label>

            <input
              id="state-name"
              autoFocus
              value={form.name}
              onChange={(event) => onChange('name', event.target.value)}
              placeholder="Example: Assam"
              maxLength={100}
              required
            />

            <small>
              This name will appear in employee, attendance, holiday and reporting
              forms.
            </small>
          </div>

          <div className="state-field">
            <label htmlFor="state-code">
              State code <span>*</span>
            </label>

            <input
              id="state-code"
              value={form.code}
              onChange={(event) =>
                onChange(
                  'code',
                  event.target.value.replace(/[^a-zA-Z]/g, '').toUpperCase(),
                )
              }
              placeholder="Example: AS"
              minLength={2}
              maxLength={2}
              required
            />

            <small>
              Enter the standard two-letter state code, such as AS, TR, MN or AR.
            </small>
          </div>

          <div className="state-field">
            <label htmlFor="state-status">Status</label>

            <select
              id="state-status"
              value={form.status}
              onChange={(event) => onChange('status', event.target.value)}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>

            <small>
              Inactive states remain available in historical records but should
              not be offered in new employee or attendance forms.
            </small>
          </div>

          {error ? <div className="state-form-error">{error}</div> : null}

          <footer className="state-modal-footer">
            <button
              type="button"
              className="state-secondary-button"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="state-primary-button"
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
                  Create State
                </>
              )}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export default function States() {
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

  const loadStates = useCallback(
    async ({ silent = false } = {}) => {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setPageError('');

      try {
        const data = await listCollection('states', {
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
            'States could not be loaded. Please check your access and try again.',
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [appliedSearch, page],
  );

  useEffect(() => {
    loadStates();
  }, [loadStates]);

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
    () => rows.filter((row) => stateCode(row).length === 2).length,
    [rows],
  );

  const alphabeticCoverage = useMemo(() => {
    const firstLetters = new Set(
      rows
        .map((row) => stateName(row).charAt(0).toUpperCase())
        .filter(Boolean),
    );

    return firstLetters.size;
  }, [rows]);

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
    const name = stateName(row);

    setEditingRow(row);
    setForm({
      name: name === 'Unnamed State' ? '' : name,
      code: stateCode(row),
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

  async function submitState(event) {
    event.preventDefault();

    const name = safeText(form.name);
    const code = safeText(form.code).toUpperCase();
    const status = safeText(form.status).toLowerCase() || 'active';

    if (!name) {
      setFormError('State name is required.');
      return;
    }

    if (!/^[A-Z]{2}$/.test(code)) {
      setFormError('State code must contain exactly two letters.');
      return;
    }

    const duplicate = rows.some((row) => {
      const currentId = recordId(row);
      const editingId = recordId(editingRow || {});

      if (editingId && currentId === editingId) {
        return false;
      }

      return (
        stateName(row).toLowerCase() === name.toLowerCase() ||
        stateCode(row) === code
      );
    });

    if (duplicate) {
      setFormError(
        'A state with the same name or two-letter code already exists on this page.',
      );
      return;
    }

    const payload = {
      name,
      state_name: name,
      code,
      state_code: code,
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
            'This state cannot be updated because its internal reference is missing.',
          );
        }

        const response = await updateCollectionItem('states', id, payload);
        setMessage(response?.message || 'State updated successfully.');
      } else {
        const response = await createCollectionItem('states', payload);
        setMessage(response?.message || 'State created successfully.');
      }

      setFormOpen(false);
      setEditingRow(null);
      setForm(EMPTY_FORM);
      await loadStates({ silent: true });
    } catch (error) {
      setFormError(
        error?.message ||
          `Unable to ${editingRow ? 'update' : 'create'} the state.`,
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeState(row) {
    const id = recordId(row);
    const name = stateName(row);

    if (!id) {
      setPageError(
        'This state cannot be removed because its internal reference is missing.',
      );
      return;
    }

    const confirmed = window.confirm(
      `Remove "${name}"?\n\nThe state will become unavailable for new assignments but remain in historical records.`,
    );

    if (!confirmed) {
      return;
    }

    setDeletingId(id);
    setPageError('');
    setMessage('');

    try {
      const response = await deleteCollectionItem('states', id);
      setMessage(response?.message || 'State removed successfully.');

      if (visibleRows.length === 1 && page > 1) {
        setPage((current) => Math.max(1, current - 1));
      } else {
        await loadStates({ silent: true });
      }
    } catch (error) {
      setPageError(error?.message || 'Unable to remove the state.');
    } finally {
      setDeletingId('');
    }
  }

  const hasFilters = Boolean(appliedSearch || statusFilter);

  return (
    <section className="states-page">
      <style>{`
        .states-page {
          --state-ink: #11182d;
          --state-muted: #66748d;
          --state-border: rgba(133, 149, 187, .28);
          --state-primary: #4f46ef;
          display: grid;
          gap: 20px;
          width: 100%;
          padding-bottom: 34px;
          color: var(--state-ink);
        }

        .state-hero,
        .state-panel {
          border: 1px solid var(--state-border);
          border-radius: 30px;
          background: rgba(255, 255, 255, .91);
          box-shadow: 0 20px 55px rgba(38, 52, 88, .09);
          backdrop-filter: blur(16px);
        }

        .state-hero {
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
            radial-gradient(circle at 94% 8%, rgba(33, 190, 141, .17), transparent 31%),
            linear-gradient(125deg, rgba(255, 255, 255, .97), rgba(247, 250, 255, .94));
        }

        .state-hero::after {
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

        .state-hero-copy {
          position: relative;
          z-index: 1;
          max-width: 820px;
        }

        .state-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: var(--state-primary);
          font-size: 12px;
          font-weight: 900;
          letter-spacing: .1em;
          text-transform: uppercase;
        }

        .state-hero h1 {
          margin: 11px 0 8px;
          font-size: clamp(32px, 4vw, 49px);
          line-height: 1.03;
          letter-spacing: -.04em;
        }

        .state-hero p {
          max-width: 780px;
          margin: 0;
          color: var(--state-muted);
          font-size: 16px;
          line-height: 1.7;
        }

        .state-primary-button,
        .state-secondary-button,
        .state-icon-button,
        .state-action-button,
        .state-page-button {
          border: 0;
          font: inherit;
          cursor: pointer;
          transition:
            transform .18s ease,
            box-shadow .18s ease,
            background .18s ease,
            border-color .18s ease;
        }

        .state-primary-button,
        .state-secondary-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-height: 47px;
          padding: 0 18px;
          border-radius: 14px;
          font-weight: 850;
        }

        .state-primary-button {
          position: relative;
          z-index: 1;
          flex: 0 0 auto;
          background: linear-gradient(135deg, #5147f4, #6b5df8);
          color: #fff;
          box-shadow: 0 14px 29px rgba(79, 70, 239, .25);
        }

        .state-secondary-button {
          border: 1px solid rgba(133, 149, 187, .32);
          background: #fff;
          color: #344054;
        }

        .state-primary-button:hover:not(:disabled),
        .state-secondary-button:hover:not(:disabled),
        .state-action-button:hover:not(:disabled),
        .state-page-button:hover:not(:disabled),
        .state-icon-button:hover:not(:disabled) {
          transform: translateY(-2px);
        }

        .state-primary-button:disabled,
        .state-secondary-button:disabled,
        .state-action-button:disabled,
        .state-page-button:disabled,
        .state-icon-button:disabled {
          cursor: not-allowed;
          opacity: .55;
        }

        .is-spinning {
          animation: state-spin .8s linear infinite;
        }

        @keyframes state-spin {
          to { transform: rotate(360deg); }
        }

        .state-kpi-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
        }

        .state-kpi {
          display: flex;
          align-items: center;
          gap: 14px;
          min-height: 108px;
          padding: 20px;
          border: 1px solid var(--state-border);
          border-radius: 22px;
          background: rgba(255, 255, 255, .92);
          box-shadow: 0 13px 34px rgba(38, 52, 88, .07);
        }

        .state-kpi-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 46px;
          height: 46px;
          flex: 0 0 46px;
          border-radius: 15px;
          background: rgba(79, 70, 239, .09);
          color: var(--state-primary);
        }

        .state-kpi span {
          display: block;
          color: var(--state-muted);
          font-size: 11px;
          font-weight: 900;
          letter-spacing: .055em;
          text-transform: uppercase;
        }

        .state-kpi strong {
          display: block;
          margin-top: 5px;
          font-size: 24px;
          line-height: 1.1;
        }

        .state-kpi small {
          display: block;
          margin-top: 5px;
          color: #8791a7;
          line-height: 1.35;
        }

        .state-panel {
          overflow: hidden;
        }

        .state-toolbar {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 18px;
          padding: 24px 26px 18px;
        }

        .state-toolbar-heading {
          display: flex;
          align-items: center;
          gap: 11px;
        }

        .state-toolbar-heading h2 {
          margin: 0;
          font-size: 21px;
        }

        .state-toolbar-heading p {
          margin: 4px 0 0;
          color: var(--state-muted);
          font-size: 13px;
        }

        .state-search-row {
          display: grid;
          grid-template-columns: minmax(270px, 1fr) minmax(170px, 240px) auto;
          gap: 12px;
          padding: 0 26px 24px;
        }

        .state-field {
          display: grid;
          gap: 7px;
        }

        .state-field label {
          color: #46536b;
          font-size: 12px;
          font-weight: 850;
        }

        .state-field label span {
          color: #dc2626;
        }

        .state-input-wrap {
          position: relative;
        }

        .state-input-wrap > svg {
          position: absolute;
          top: 50%;
          left: 14px;
          transform: translateY(-50%);
          color: #78839c;
          pointer-events: none;
        }

        .state-field input,
        .state-field select {
          width: 100%;
          min-height: 46px;
          border: 1px solid rgba(133, 149, 187, .36);
          border-radius: 14px;
          outline: none;
          background: rgba(248, 250, 255, .88);
          color: var(--state-ink);
          font: inherit;
          padding: 0 14px;
          transition:
            border-color .18s ease,
            box-shadow .18s ease,
            background .18s ease;
        }

        .state-input-wrap input {
          padding-left: 43px;
        }

        .state-field input:focus,
        .state-field select:focus {
          border-color: rgba(79, 70, 239, .58);
          background: #fff;
          box-shadow: 0 0 0 4px rgba(79, 70, 239, .09);
        }

        .state-field small {
          color: var(--state-muted);
          font-size: 12px;
          line-height: 1.45;
        }

        .state-feedback {
          margin: 0 26px 20px;
          padding: 14px 16px;
          border-radius: 15px;
          font-weight: 750;
        }

        .state-feedback.success {
          border: 1px solid rgba(16, 185, 129, .22);
          background: rgba(209, 250, 229, .58);
          color: #08775c;
        }

        .state-feedback.error {
          border: 1px solid rgba(220, 38, 38, .2);
          background: rgba(254, 226, 226, .62);
          color: #ac2029;
        }

        .state-clear-row {
          padding: 0 26px 18px;
        }

        .state-table-wrap {
          overflow-x: auto;
          border-top: 1px solid rgba(133, 149, 187, .2);
          -webkit-overflow-scrolling: touch;
        }

        .state-table {
          width: 100%;
          min-width: 820px;
          border-collapse: collapse;
        }

        .state-table th {
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

        .state-table td {
          padding: 17px 18px;
          border-top: 1px solid rgba(133, 149, 187, .15);
          vertical-align: middle;
        }

        .state-table tbody tr {
          transition: background .18s ease;
        }

        .state-table tbody tr:hover {
          background: rgba(79, 70, 239, .035);
        }

        .state-name-cell {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 245px;
        }

        .state-name-icon {
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

        .state-name-cell strong {
          display: block;
        }

        .state-name-cell small {
          display: block;
          margin-top: 4px;
          color: var(--state-muted);
        }

        .state-code {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 48px;
          padding: 8px 12px;
          border-radius: 11px;
          background: rgba(59, 130, 246, .09);
          color: #285f9f;
          font-size: 13px;
          font-weight: 950;
          letter-spacing: .08em;
          white-space: nowrap;
        }

        .state-status {
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

        .state-status.active {
          background: rgba(16, 185, 129, .11);
          color: #08775c;
        }

        .state-status.inactive {
          background: rgba(100, 116, 139, .11);
          color: #596579;
        }

        .state-updated {
          display: grid;
          gap: 4px;
          min-width: 170px;
        }

        .state-updated small {
          color: var(--state-muted);
        }

        .state-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          white-space: nowrap;
        }

        .state-action-button {
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

        .state-action-button.edit {
          border-color: rgba(79, 70, 239, .23);
          background: rgba(79, 70, 239, .055);
          color: #433bb8;
        }

        .state-action-button.delete {
          border-color: rgba(220, 38, 38, .18);
          background: rgba(254, 226, 226, .45);
          color: #b4232c;
        }

        .state-loading {
          display: grid;
          gap: 11px;
          padding: 28px 26px;
          border-top: 1px solid rgba(133, 149, 187, .18);
        }

        .state-loading span {
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
          animation: state-skeleton 1.25s linear infinite;
        }

        @keyframes state-skeleton {
          to { background-position: -220% 0; }
        }

        .state-empty {
          display: grid;
          justify-items: center;
          gap: 10px;
          padding: 50px 22px;
          border-top: 1px solid rgba(133, 149, 187, .18);
          color: var(--state-muted);
          text-align: center;
        }

        .state-empty svg {
          color: #7066df;
        }

        .state-empty h3 {
          margin: 0;
          color: var(--state-ink);
        }

        .state-empty p {
          max-width: 540px;
          margin: 0;
          line-height: 1.6;
        }

        .state-mobile-list {
          display: none;
          gap: 12px;
          padding: 16px;
          border-top: 1px solid rgba(133, 149, 187, .18);
        }

        .state-mobile-card {
          display: grid;
          gap: 14px;
          padding: 17px;
          border: 1px solid rgba(133, 149, 187, .23);
          border-radius: 18px;
          background: rgba(255, 255, 255, .98);
          box-shadow: 0 10px 26px rgba(38, 52, 88, .06);
        }

        .state-mobile-top,
        .state-mobile-bottom {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
        }

        .state-mobile-title {
          display: flex;
          align-items: center;
          gap: 11px;
          min-width: 0;
        }

        .state-mobile-title > div:last-child {
          min-width: 0;
        }

        .state-mobile-title h3 {
          margin: 0;
          overflow-wrap: anywhere;
          font-size: 17px;
        }

        .state-mobile-title p {
          margin: 4px 0 0;
          color: var(--state-muted);
          font-size: 13px;
        }

        .state-mobile-meta {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }

        .state-mobile-meta article {
          min-width: 0;
          padding: 11px;
          border-radius: 13px;
          background: rgba(247, 248, 253, .92);
        }

        .state-mobile-meta span {
          display: block;
          color: var(--state-muted);
          font-size: 11px;
          font-weight: 850;
          text-transform: uppercase;
        }

        .state-mobile-meta strong {
          display: block;
          margin-top: 5px;
          overflow-wrap: anywhere;
          font-size: 13px;
        }

        .state-pagination {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 18px 24px;
          border-top: 1px solid rgba(133, 149, 187, .18);
        }

        .state-pagination p {
          margin: 0;
          color: var(--state-muted);
          font-size: 13px;
        }

        .state-pagination-controls {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .state-page-button {
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

        .state-page-indicator {
          min-width: 88px;
          text-align: center;
          color: #3d4960;
          font-size: 13px;
          font-weight: 800;
        }

        .state-modal-backdrop {
          position: fixed;
          z-index: 2600;
          inset: 0;
          display: grid;
          place-items: center;
          padding: 22px;
          background: rgba(14, 22, 42, .56);
          backdrop-filter: blur(8px);
        }

        .state-modal {
          width: min(620px, 100%);
          max-height: 92vh;
          overflow-y: auto;
          border: 1px solid rgba(255, 255, 255, .45);
          border-radius: 28px;
          background: #fff;
          box-shadow: 0 34px 90px rgba(9, 16, 35, .3);
          animation: state-modal-enter .2s ease-out;
        }

        @keyframes state-modal-enter {
          from {
            opacity: 0;
            transform: translateY(12px) scale(.985);
          }

          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        .state-modal-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 20px;
          padding: 27px 28px 22px;
          border-bottom: 1px solid rgba(133, 149, 187, .18);
          background:
            radial-gradient(circle at 92% 0%, rgba(33, 190, 141, .15), transparent 35%),
            radial-gradient(circle at 5% 0%, rgba(99, 88, 245, .14), transparent 39%),
            #fff;
        }

        .state-modal-header h2 {
          margin: 8px 0 6px;
          font-size: 28px;
          letter-spacing: -.025em;
        }

        .state-modal-header p {
          max-width: 500px;
          margin: 0;
          color: var(--state-muted);
          line-height: 1.55;
        }

        .state-icon-button {
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

        .state-form {
          display: grid;
          gap: 18px;
          padding: 24px 28px 28px;
        }

        .state-form-error {
          padding: 14px 15px;
          border: 1px solid rgba(220, 38, 38, .2);
          border-radius: 14px;
          background: rgba(254, 226, 226, .6);
          color: #a91e28;
          font-weight: 750;
        }

        .state-modal-footer {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          padding-top: 4px;
        }

        @media (max-width: 1050px) {
          .state-kpi-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 820px) {
          .state-table-wrap {
            display: none;
          }

          .state-mobile-list {
            display: grid;
          }

          .state-search-row {
            grid-template-columns: 1fr 1fr;
          }

          .state-search-row > button {
            grid-column: 1 / -1;
          }
        }

        @media (max-width: 640px) {
          .states-page {
            gap: 16px;
          }

          .state-hero {
            align-items: flex-start;
            flex-direction: column;
            min-height: auto;
            padding: 25px 21px;
            border-radius: 24px;
          }

          .state-hero .state-primary-button {
            width: 100%;
          }

          .state-kpi-grid {
            grid-template-columns: 1fr;
          }

          .state-kpi {
            min-height: 92px;
          }

          .state-toolbar {
            align-items: flex-start;
            flex-direction: column;
            padding: 21px 18px 16px;
          }

          .state-toolbar .state-secondary-button {
            width: 100%;
          }

          .state-search-row {
            grid-template-columns: 1fr;
            padding: 0 18px 20px;
          }

          .state-search-row > button {
            grid-column: auto;
            width: 100%;
          }

          .state-clear-row {
            padding-left: 18px;
            padding-right: 18px;
          }

          .state-clear-row button {
            width: 100%;
          }

          .state-feedback {
            margin-left: 18px;
            margin-right: 18px;
          }

          .state-mobile-list {
            padding-left: 12px;
            padding-right: 12px;
          }

          .state-mobile-bottom {
            flex-direction: column;
          }

          .state-actions {
            width: 100%;
          }

          .state-actions .state-action-button {
            flex: 1 1 0;
          }

          .state-pagination {
            align-items: flex-start;
            flex-direction: column;
          }

          .state-pagination-controls {
            width: 100%;
            justify-content: space-between;
          }

          .state-modal-backdrop {
            align-items: end;
            padding: 0;
          }

          .state-modal {
            width: 100%;
            max-height: 94vh;
            border-radius: 25px 25px 0 0;
          }

          .state-modal-header,
          .state-form {
            padding-left: 19px;
            padding-right: 19px;
          }

          .state-modal-footer {
            flex-direction: column-reverse;
          }

          .state-modal-footer button {
            width: 100%;
          }
        }

        @media (max-width: 430px) {
          .state-mobile-top {
            flex-direction: column;
          }

          .state-mobile-meta {
            grid-template-columns: 1fr;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .states-page *,
          .states-page *::before,
          .states-page *::after {
            animation-duration: .01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: .01ms !important;
          }
        }
      `}</style>

      <header className="state-hero">
        <div className="state-hero-copy">
          <span className="state-eyebrow">
            <ShieldCheck size={17} />
            Operating locations
          </span>

          <h1>States</h1>

          <p>
            Maintain the operating states used in employee records, attendance,
            holiday calendars, branches, reports and payroll configuration.
            Internal database IDs are intentionally hidden.
          </p>
        </div>

        <button
          type="button"
          className="state-primary-button"
          onClick={openCreateForm}
        >
          <Plus size={18} />
          Add State
        </button>
      </header>

      <div className="state-kpi-grid">
        <article className="state-kpi">
          <span className="state-kpi-icon">
            <Map size={22} />
          </span>

          <div>
            <span>Total states</span>
            <strong>{total.toLocaleString('en-IN')}</strong>
            <small>Available in your company scope</small>
          </div>
        </article>

        <article className="state-kpi">
          <span className="state-kpi-icon">
            <BadgeCheck size={22} />
          </span>

          <div>
            <span>Active on page</span>
            <strong>{activeCount.toLocaleString('en-IN')}</strong>
            <small>Available in operational forms</small>
          </div>
        </article>

        <article className="state-kpi">
          <span className="state-kpi-icon">
            <CircleOff size={22} />
          </span>

          <div>
            <span>Inactive on page</span>
            <strong>{inactiveCount.toLocaleString('en-IN')}</strong>
            <small>Retained for historical records</small>
          </div>
        </article>

        <article className="state-kpi">
          <span className="state-kpi-icon">
            <Globe2 size={22} />
          </span>

          <div>
            <span>Valid codes</span>
            <strong>{codedCount.toLocaleString('en-IN')}</strong>
            <small>
              Covering {alphabeticCoverage.toLocaleString('en-IN')} alphabetic
              group{alphabeticCoverage === 1 ? '' : 's'}
            </small>
          </div>
        </article>
      </div>

      <section className="state-panel">
        <div className="state-toolbar">
          <div className="state-toolbar-heading">
            <Activity size={21} />

            <div>
              <h2>State directory</h2>
              <p>
                Search, create, update and safely deactivate operating states
                without exposing internal IDs.
              </p>
            </div>
          </div>

          <button
            type="button"
            className="state-secondary-button"
            onClick={() => loadStates({ silent: true })}
            disabled={refreshing}
          >
            <RefreshCw
              size={17}
              className={refreshing ? 'is-spinning' : ''}
            />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        <form className="state-search-row" onSubmit={applySearch}>
          <div className="state-field">
            <label htmlFor="state-search">Search states</label>

            <div className="state-input-wrap">
              <Search size={18} />

              <input
                id="state-search"
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="State name or two-letter code"
              />
            </div>
          </div>

          <div className="state-field">
            <label htmlFor="state-status-filter">Status</label>

            <select
              id="state-status-filter"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="">All statuses</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </select>
          </div>

          <button type="submit" className="state-primary-button">
            <Search size={17} />
            Search
          </button>
        </form>

        {hasFilters ? (
          <div className="state-clear-row">
            <button
              type="button"
              className="state-secondary-button"
              onClick={clearFilters}
            >
              <X size={17} />
              Clear Filters
            </button>
          </div>
        ) : null}

        {message ? (
          <div className="state-feedback success">{message}</div>
        ) : null}

        {pageError ? (
          <div className="state-feedback error">{pageError}</div>
        ) : null}

        {loading ? (
          <div className="state-loading" aria-label="Loading states">
            <span />
            <span />
            <span />
            <span />
          </div>
        ) : visibleRows.length > 0 ? (
          <>
            <div className="state-table-wrap">
              <table className="state-table">
                <thead>
                  <tr>
                    <th>State</th>
                    <th>Code</th>
                    <th>Status</th>
                    <th>Last updated</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {visibleRows.map((row, index) => {
                    const id = recordId(row);
                    const code = stateCode(row);
                    const status = statusValue(row);

                    return (
                      <tr
                        key={
                          id || `${stateName(row)}-${code || 'no-code'}-${index}`
                        }
                      >
                        <td>
                          <div className="state-name-cell">
                            <span className="state-name-icon">
                              <MapPin size={20} />
                            </span>

                            <div>
                              <strong>{stateName(row)}</strong>
                              <small>Operating-state master record</small>
                            </div>
                          </div>
                        </td>

                        <td>
                          <span className="state-code">{code || '—'}</span>
                        </td>

                        <td>
                          <span className={`state-status ${status}`}>
                            {status === 'active' ? (
                              <BadgeCheck size={15} />
                            ) : (
                              <CircleOff size={15} />
                            )}
                            {statusLabel(status)}
                          </span>
                        </td>

                        <td>
                          <div className="state-updated">
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
                          <div className="state-actions">
                            <button
                              type="button"
                              className="state-action-button edit"
                              onClick={() => openEditForm(row)}
                            >
                              <Edit3 size={16} />
                              Edit
                            </button>

                            <button
                              type="button"
                              className="state-action-button delete"
                              onClick={() => removeState(row)}
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

            <div className="state-mobile-list">
              {visibleRows.map((row, index) => {
                const id = recordId(row);
                const code = stateCode(row);
                const status = statusValue(row);

                return (
                  <article
                    className="state-mobile-card"
                    key={
                      id ||
                      `mobile-${stateName(row)}-${code || 'no-code'}-${index}`
                    }
                  >
                    <div className="state-mobile-top">
                      <div className="state-mobile-title">
                        <span className="state-name-icon">
                          <MapPin size={20} />
                        </span>

                        <div>
                          <h3>{stateName(row)}</h3>
                          <p>{code || 'No state code assigned'}</p>
                        </div>
                      </div>

                      <span className={`state-status ${status}`}>
                        {status === 'active' ? (
                          <BadgeCheck size={15} />
                        ) : (
                          <CircleOff size={15} />
                        )}
                        {statusLabel(status)}
                      </span>
                    </div>

                    <div className="state-mobile-meta">
                      <article>
                        <span>State code</span>
                        <strong>{code || 'Not assigned'}</strong>
                      </article>

                      <article>
                        <span>Last updated</span>
                        <strong>
                          {formatDateTime(row.updated_at || row.created_at)}
                        </strong>
                      </article>
                    </div>

                    <div className="state-mobile-bottom">
                      <small>
                        Updated by{' '}
                        {safeText(row.updated_by_name) ||
                          safeText(row.created_by_name) ||
                          'the system'}
                      </small>

                      <div className="state-actions">
                        <button
                          type="button"
                          className="state-action-button edit"
                          onClick={() => openEditForm(row)}
                        >
                          <Edit3 size={16} />
                          Edit
                        </button>

                        <button
                          type="button"
                          className="state-action-button delete"
                          onClick={() => removeState(row)}
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
          <div className="state-empty">
            <MapPin size={44} />
            <h3>No states found</h3>
            <p>
              No state matches the current search and status filter. Clear the
              filters or create a new operating state.
            </p>

            <button
              type="button"
              className="state-primary-button"
              onClick={openCreateForm}
            >
              <Plus size={17} />
              Add State
            </button>
          </div>
        )}

        <footer className="state-pagination">
          <p>
            Page {page} of {pageCount} • {total.toLocaleString('en-IN')} total
            state{total === 1 ? '' : 's'}
          </p>

          <div className="state-pagination-controls">
            <button
              type="button"
              className="state-page-button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1 || loading}
              aria-label="Previous page"
            >
              <ChevronLeft size={19} />
            </button>

            <span className="state-page-indicator">
              {page} / {pageCount}
            </span>

            <button
              type="button"
              className="state-page-button"
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

      <StateFormModal
        open={formOpen}
        editing={Boolean(editingRow)}
        form={form}
        saving={saving}
        error={formError}
        onChange={updateForm}
        onClose={closeForm}
        onSubmit={submitState}
      />
    </section>
  );
}