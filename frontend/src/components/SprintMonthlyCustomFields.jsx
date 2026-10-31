// STEP 44B.53C.6 - Department monthly fields, using the saved template snapshot
import React from 'react';

function renderField(column, value, onChange, disabled, id) {
  const common = {
    id,
    disabled,
    'aria-label': column.label,
    style: {
      width: '100%',
      boxSizing: 'border-box',
      padding: '9px 10px',
      borderRadius: 8,
      border: '1px solid #cbd5e1',
      background: 'var(--card-bg, #fff)',
      color: 'inherit',
    },
  };

  if (column.type === 'checkbox') {
    return (
      <input
        type="checkbox"
        id={id}
        disabled={disabled}
        checked={value === true}
        onChange={(event) => onChange(event.target.checked)}
      />
    );
  }

  if (column.type === 'select') {
    return (
      <select
        {...common}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Select an option</option>
        {(column.options || []).map((option) => (
          <option value={option} key={option}>{option}</option>
        ))}
      </select>
    );
  }

  if (column.type === 'textarea') {
    return (
      <textarea
        {...common}
        rows={2}
        maxLength={5000}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  return (
    <input
      {...common}
      type={
        column.type === 'number' ? 'number'
        : column.type === 'date' ? 'date'
        : 'text'
      }
      step={column.type === 'number' ? 'any' : undefined}
      maxLength={
        column.type === 'file' ? 1000 : 500
      }
      placeholder={
        column.type === 'file'
          ? 'Enter an existing uploaded file reference'
          : column.label
      }
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export default function SprintMonthlyCustomFields({
  template,
  rows,
  onChange,
  disabled = false,
}) {
  if (!template?.columns?.length) return null;

  return (
    <section
      className="mws-card"
      aria-label="Department-specific planning columns"
      style={{ padding: 18, marginTop: 14 }}
    >
      <div className="mws-section-head">
        <div>
          <h3 style={{ margin: 0, fontSize: 17 }}>
            {template.department} - Custom Monthly Planning Fields
          </h3>
          <p className="mws-muted" style={{ margin: '6px 0 0' }}>
            Department template version {template.version}.
            These fields are saved against each activity row.
          </p>
        </div>
      </div>

      {rows.map((row, rowIndex) => (
        <div
          key={row.key || rowIndex}
          style={{
            padding: '14px 0',
            borderBottom: '1px solid #e2e8f0',
          }}
        >
          <strong>
            {`Activity ${rowIndex + 1}: `}
            {row.activity || 'Untitled activity'}
          </strong>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
              gap: 12,
              marginTop: 12,
            }}
          >
            {template.columns.map((column) => {
              const id = `sprint-custom-${rowIndex}-${column.key}`;
              const value = row.custom_values?.[column.key];
              return (
                <label key={column.key} htmlFor={id}>
                  <span style={{ display: 'block', marginBottom: 6 }}>
                    {column.label}{column.required ? ' *' : ''}
                  </span>
                  {renderField(
                    column,
                    value,
                    (next) => onChange(row.key, column.key, next),
                    disabled,
                    id,
                  )}
                </label>
              );
            })}
          </div>
        </div>
      ))}

      <p className="mws-muted" style={{ marginTop: 12 }}>
        Required custom fields must be completed before saving.
        The existing Objective, Activity, KPI and Weightage checks still apply.
      </p>
    </section>
  );
}
