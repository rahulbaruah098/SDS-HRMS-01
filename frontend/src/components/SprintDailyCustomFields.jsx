// STEP 44B.53E.6R - Daily fields
import React from 'react';

const style = {
  width: '100%',
  padding: '9px 11px',
  boxSizing: 'border-box',
  border: '1px solid var(--border, #cbd5e1)',
  borderRadius: 8,
  background: 'var(--card-bg, #fff)',
  color: 'inherit',
};

export default function SprintDailyCustomFields({
  template, values = {}, onChange, disabled = false,
}) {
  if (!template?.columns?.length) return null;

  return (
    <section style={{
      padding: 14,
      border: '1px solid var(--border, #dbe1e8)',
      borderRadius: 10,
    }}>
      <strong>Department Daily Reporting Fields</strong>
      <p style={{ fontSize: 12, opacity: 0.75 }}>
        {template.department} ? Template version {template.version}
      </p>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
        gap: 12,
      }}>
        {template.columns.map(column => {
          const value = values[column.key];

          return (
            <label key={column.key}>
              <span style={{ display: 'block', marginBottom: 5 }}>
                {column.label}{column.required ? ' *' : ''}
              </span>

              {column.type === 'checkbox' ? (
                <input
                  type="checkbox"
                  checked={value === true}
                  disabled={disabled}
                  onChange={e => onChange(column.key, e.target.checked)}
                />
              ) : column.type === 'select' ? (
                <select
                  style={style}
                  value={value ?? ''}
                  disabled={disabled}
                  onChange={e => onChange(column.key, e.target.value)}
                >
                  <option value="">Select</option>
                  {(column.options || []).map(option => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              ) : column.type === 'textarea' ? (
                <textarea
                  style={style}
                  rows={3}
                  value={value ?? ''}
                  disabled={disabled}
                  onChange={e => onChange(column.key, e.target.value)}
                />
              ) : (
                <input
                  style={style}
                  type={column.type === 'number' ? 'number'
                    : column.type === 'date' ? 'date' : 'text'}
                  step={column.type === 'number' ? 'any' : undefined}
                  value={value ?? ''}
                  placeholder={column.type === 'file'
                    ? 'Existing uploaded file reference'
                    : column.label}
                  disabled={disabled}
                  onChange={e => onChange(column.key, e.target.value)}
                />
              )}
            </label>
          );
        })}
      </div>
    </section>
  );
}
