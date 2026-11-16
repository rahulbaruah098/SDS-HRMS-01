// STEP 44B.53B.1 - Versioned department Sprint sheet editor
import { useEffect, useState } from 'react';
import {
  ArrowDown, ArrowUp, Plus, RefreshCw, Save, Trash2,
} from 'lucide-react';
import {
  getSprintSheetTemplates,
  saveSprintSheetTemplate,
} from '../api/sprintPlanning';

const TYPES = [
  'text', 'textarea', 'number', 'date',
  'select', 'checkbox', 'file',
];

const DEFAULT_COLUMN = {
  key: 'task_name',
  label: 'Task / Activity',
  type: 'text',
  required: true,
  options: [],
};

const freshColumns = () => [{ ...DEFAULT_COLUMN }];

const card = {
  border: '1px solid var(--border-color, #dce3eb)',
  borderRadius: 12,
  padding: 16,
  marginBottom: 14,
  background: 'var(--card-bg, #fff)',
};

const field = {
  padding: '10px 12px',
  border: '1px solid #cbd5e1',
  borderRadius: 8,
  background: 'var(--card-bg, #fff)',
  color: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
};

const action = {
  padding: '9px 14px',
  borderRadius: 8,
  border: '1px solid #cbd5e1',
  cursor: 'pointer',
  background: 'var(--card-bg, #fff)',
  color: 'inherit',
};

function cleanLoadedColumns(columns) {
  if (!Array.isArray(columns) || !columns.length) return freshColumns();
  return columns.map((column) => ({
    key: String(column.key || ''),
    label: String(column.label || ''),
    type: String(column.type || 'text'),
    required: column.required === true,
    options: Array.isArray(column.options) ? [...column.options] : [],
  }));
}

export default function SprintTemplateBuilder() {
  const [department, setDepartment] = useState('IT');
  const [planType, setPlanType] = useState('monthly');
  const [columns, setColumns] = useState(freshColumns);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [reload, setReload] = useState(0);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError('');
      setMessage('');
      try {
        const data = await getSprintSheetTemplates({
          department: department.trim(),
          plan_type: planType,
        });

        if (!active) return;

        const matches = (data?.templates || []).filter(
          (template) =>
            template.department === department.trim() &&
            template.plan_type === planType,
        );
        const latest = matches.reduce(
          (best, next) =>
            !best || next.version > best.version ? next : best,
          null,
        );

        setColumns(cleanLoadedColumns(latest?.columns));
        setVersion(latest?.version || 0);
        setDirty(false);
      } catch (err) {
        if (active) {
          setError(err?.message || 'Could not load department template.');
          setColumns(freshColumns());
          setVersion(0);
          setDirty(false);
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    if (department.trim()) {
      load();
    } else {
      setColumns(freshColumns());
      setVersion(0);
      setDirty(false);
      setLoading(false);
    }

    return () => { active = false; };
  }, [department, planType, reload]);

  const busy = loading || saving;

  function updateColumn(index, patch) {
    setColumns((previous) =>
      previous.map((item, i) => i === index ? { ...item, ...patch } : item),
    );
    setDirty(true);
    setMessage('');
  }

  function moveColumn(index, direction) {
    const destination = index + direction;
    if (destination < 0 || destination >= columns.length) return;

    setColumns((previous) => {
      const next = [...previous];
      [next[index], next[destination]] = [
        next[destination], next[index],
      ];
      return next;
    });
    setDirty(true);
  }

  function addColumn() {
    if (columns.length >= 40) return;

    const existing = new Set(columns.map((item) => item.key));
    let number = columns.length + 1;
    while (existing.has(`column_${number}`)) number += 1;

    setColumns((previous) => [
      ...previous,
      {
        key: `column_${number}`,
        label: `New Column ${number}`,
        type: 'text',
        required: false,
        options: [],
      },
    ]);
    setDirty(true);
  }

  function removeColumn(index) {
    if (columns.length <= 1) {
      setError('A planning sheet must have at least one column.');
      return;
    }

    setColumns((previous) => previous.filter((_, i) => i !== index));
    setDirty(true);
  }

  async function save(event) {
    event.preventDefault();
    setError('');
    setMessage('');

    if (!department.trim()) {
      setError('Enter a department name.');
      return;
    }

    if (!window.confirm(
      `Save a new ${planType} template version for ${department.trim()}? ` +
      'Earlier versions will be retained.',
    )) return;

    setSaving(true);

    try {
      const payload = {
        department: department.trim(),
        plan_type: planType,
        columns: columns.map((column) => ({
          key: column.key.trim().toLowerCase(),
          label: column.label.trim(),
          type: column.type,
          required: column.required,
          options: column.type === 'select'
            ? column.options
            : [],
        })),
      };

      const result = await saveSprintSheetTemplate(payload);
      setVersion(result?.template?.version || version + 1);
      setDirty(false);
      setMessage(
        `Template version ${result?.template?.version || version + 1} saved. ` +
        'Previously approved plans remain unchanged.',
      );
      setReload((value) => value + 1);
    } catch (err) {
      setError(err?.message || 'Unable to save the planning template.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="payroll-branding-panel"
      aria-label="Department Sprint Planning Templates"
      style={{ marginBottom: 24 }}
    >
      <div className="payroll-branding-heading">
        <div>
          <span className="payroll-branding-kicker">
            Department Planning Sheets
          </span>
          <h1>Dynamic Sprint Planning Template Builder</h1>
          <p>
            Configure a separate monthly, weekly or daily planning sheet for
            each department. Saved versions are retained for history.
          </p>
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
        gap: 14,
        marginBottom: 18,
      }}>
        <label>
          <span style={{ display: 'block', marginBottom: 6 }}>
            Department
          </span>
          <input
            style={field}
            value={department}
            maxLength={100}
            disabled={busy}
            onChange={(event) => setDepartment(event.target.value)}
            placeholder="IT, HR, Accounts, Operations..."
          />
        </label>

        <label>
          <span style={{ display: 'block', marginBottom: 6 }}>
            Planning Sheet
          </span>
          <select
            style={field}
            value={planType}
            disabled={busy}
            onChange={(event) => setPlanType(event.target.value)}
          >
            <option value="monthly">Monthly</option>
            <option value="weekly">Weekly</option>
            <option value="daily">Daily</option>
          </select>
        </label>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', gap: 12,
        marginBottom: 16, flexWrap: 'wrap',
      }}>
        <strong>
          {loading ? 'Loading...' :
            version ? `Saved version ${version}` : 'New template'}
          {dirty ? ' (unsaved changes)' : ''}
        </strong>
        <button
          style={action}
          type="button"
          disabled={busy}
          onClick={() => {
            if (dirty && !window.confirm('Discard unsaved changes?')) return;
            setReload((value) => value + 1);
          }}
        >
          <RefreshCw size={15} style={{ verticalAlign: 'middle' }} />
          {' '}Reload
        </button>
      </div>

      <form onSubmit={save}>
        {columns.map((column, index) => (
          <div style={card} key={`${index}-${column.key}`}>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              alignItems: 'center', gap: 8, marginBottom: 14,
            }}>
              <strong>Column {index + 1}</strong>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button" style={action}
                  aria-label={`Move column ${index + 1} up`}
                  disabled={busy || index === 0}
                  onClick={() => moveColumn(index, -1)}
                ><ArrowUp size={16} /></button>
                <button
                  type="button" style={action}
                  aria-label={`Move column ${index + 1} down`}
                  disabled={busy || index === columns.length - 1}
                  onClick={() => moveColumn(index, 1)}
                ><ArrowDown size={16} /></button>
                <button
                  type="button" style={action}
                  aria-label={`Remove column ${index + 1}`}
                  disabled={busy || columns.length <= 1}
                  onClick={() => removeColumn(index)}
                ><Trash2 size={16} /></button>
              </div>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))',
              gap: 12,
            }}>
              <label>
                <span>Column Label</span>
                <input
                  style={field}
                  required
                  maxLength={100}
                  disabled={busy}
                  value={column.label}
                  onChange={(event) =>
                    updateColumn(index, { label: event.target.value })}
                />
              </label>
              <label>
                <span>Column Key</span>
                <input
                  style={field}
                  required
                  maxLength={50}
                  disabled={busy}
                  value={column.key}
                  onChange={(event) =>
                    updateColumn(index, { key: event.target.value })}
                  placeholder="task_name"
                />
              </label>
              <label>
                <span>Field Type</span>
                <select
                  style={field}
                  value={column.type}
                  disabled={busy}
                  onChange={(event) =>
                    updateColumn(index, {
                      type: event.target.value,
                      options: event.target.value === 'select'
                        ? (column.options.length ? column.options : ['Option 1'])
                        : [],
                    })}
                >
                  {TYPES.map((type) =>
                    <option key={type} value={type}>{type}</option>)}
                </select>
              </label>
            </div>

            {column.type === 'select' && (
              <label style={{ display: 'block', marginTop: 12 }}>
                Dropdown Options (one per line)
                <textarea
                  style={{ ...field, minHeight: 75 }}
                  value={column.options.join('\n')}
                  disabled={busy}
                  onChange={(event) =>
                    updateColumn(index, {
                      options: event.target.value.split('\n'),
                    })}
                />
              </label>
            )}

            <label style={{
              display: 'inline-flex', alignItems: 'center',
              gap: 8, marginTop: 12,
            }}>
              <input
                type="checkbox"
                checked={column.required}
                disabled={busy}
                onChange={(event) =>
                  updateColumn(index, { required: event.target.checked })}
              />
              Required column
            </label>
          </div>
        ))}

        <div style={{
          display: 'flex', gap: 12,
          flexWrap: 'wrap', marginTop: 16,
        }}>
          <button
            style={action}
            type="button"
            disabled={busy || columns.length >= 40}
            onClick={addColumn}
          >
            <Plus size={16} style={{ verticalAlign: 'middle' }} />
            {' '}Add Column
          </button>

          <button
            style={{
              ...action,
              background: '#0f766e',
              color: '#fff',
              borderColor: '#0f766e',
            }}
            type="submit"
            disabled={busy || !dirty || !department.trim()}
          >
            <Save size={16} style={{ verticalAlign: 'middle' }} />
            {' '}{saving ? 'Saving...' : 'Save New Template Version'}
          </button>
        </div>
      </form>

      {error && (
        <p role="alert" style={{ color: '#b91c1c', marginTop: 12 }}>
          {error}
        </p>
      )}
      {message && (
        <p role="status" style={{ color: '#047857', marginTop: 12 }}>
          {message}
        </p>
      )}
      <p style={{ marginTop: 16, opacity: 0.8, fontSize: 13 }}>
        Template editing does not activate Sprint Planning or change any
        existing approved monthly, weekly or daily report.
      </p>
    </section>
  );
}
