// STEP 44B.53D.3 - Read-only custom values for a compiled activity
import React from 'react';

export default function SprintMonthlyInlineFields({ template, row }) {
  const columns = template?.columns;
  if (!Array.isArray(columns) || columns.length === 0) {
    return <span className="mws-muted">?</span>;
  }

  return (
    <div style={{ minWidth: 170 }}>
      <div
        className="mws-muted"
        style={{ fontSize: 11, marginBottom: 7 }}
      >
        {template.department} ? Template v{template.version}
      </div>
      {columns.map(column => {
        const value = row?.custom_values?.[column.key];
        let display;

        if (value === null || value === undefined || value === '') {
          display = '?';
        } else if (column.type === 'checkbox') {
          display = value === true ? 'Yes' : 'No';
        } else if (Array.isArray(value)) {
          display = value.join(', ');
        } else {
          display = String(value);
        }

        return (
          <div
            key={column.key}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              marginBottom: 8,
              overflowWrap: 'anywhere',
            }}
          >
            <strong style={{ fontSize: 11 }}>{column.label}</strong>
            <span>{display}</span>
          </div>
        );
      })}
    </div>
  );
}
