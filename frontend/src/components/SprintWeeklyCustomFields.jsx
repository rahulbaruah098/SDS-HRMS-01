// STEP 44B.53E.3 - Dynamic fields for weekly activities
import React from 'react';

const control = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '9px 11px',
  borderRadius: 8,
  border: '1px solid var(--border, #cbd5e1)',
  background: 'var(--card-bg, #fff)',
  color: 'inherit',
};

function DynamicInput({ column, value, onChange, disabled }) {
  if (column.type === 'checkbox') {
    return (
      <input
        type="checkbox"
        checked={value === true}
        disabled={disabled}
        onChange={event => onChange(event.target.checked)}
        aria-label={column.label}
      />
    );
  }

  if (column.type === 'select') {
    return (
      <select
        style={control}
        value={value ?? ''}
        onChange={event => onChange(event.target.value)}
        disabled={disabled}
        aria-label={column.label}
      >
        <option value="">Select an option</option>
        {(column.options || []).map(option => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    );
  }

  if (column.type === 'textarea') {
    return (
      <textarea
        style={control}
        rows={2}
        value={value ?? ''}
        maxLength={5000}
        disabled={disabled}
        aria-label={column.label}
        onChange={event => onChange(event.target.value)}
      />
    );
  }

  return (
    <input
      style={control}
      type={column.type === 'number' ? 'number' :
        column.type === 'date' ? 'date' : 'text'}
      value={value ?? ''}
      step={column.type === 'number' ? 'any' : undefined}
      maxLength={column.type === 'file' ? 1000 : 500}
      placeholder={column.type === 'file'
        ? 'Existing uploaded file reference'
        : column.label}
      disabled={disabled}
      aria-label={column.label}
      onChange={event => onChange(event.target.value)}
    />
  );
}

export default function SprintWeeklyCustomFields({
  template, activities, onChange, disabled = false,
}) {
  if (!template?.columns?.length) return null;

  return (
    <section
      aria-label="Weekly department planning fields"
      style={{
        border: '1px solid var(--border, #dbe1e8)',
        borderRadius: 12,
        padding: 16,
        marginTop: 16,
      }}
    >
      <h3 style={{ margin: '0 0 6px', fontSize: 17 }}>
        Department-Specific Weekly Planning Fields
      </h3>
      <p style={{ margin: '0 0 14px', opacity: 0.75 }}>
        {template.department} ? Template version {template.version}
      </p>

      {activities.map((activity, index) => (
        <div
          key={index}
          style={{
            padding: '12px 0',
            borderBottom: '1px solid var(--border, #e2e8f0)',
          }}
        >
          <strong>
            Activity {index + 1}: {activity.title || 'Untitled'}
          </strong>

          <div style={{
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fit, minmax(210px, 1fr))',
            gap: 12,
            marginTop: 12,
          }}>
            {template.columns.map(column => (
              <label key={column.key}>
                <span style={{
                  display: 'block', marginBottom: 5,
                }}>
                  {column.label}{column.required ? ' *' : ''}
                </span>
                <DynamicInput
                  column={column}
                  value={activity.custom_values?.[column.key]}
                  disabled={disabled}
                  onChange={value =>
                    onChange(index, column.key, value)
                  }
                />
              </label>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
