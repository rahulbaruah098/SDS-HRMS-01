// STEP 44B.53D.1 - Read-only saved monthly template columns
import React from 'react';

function displayValue(value, column) {
  if (value === undefined || value === null || value === '') {
    return '?';
  }
  if (column.type === 'checkbox') {
    return value === true ? 'Yes' : 'No';
  }
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  return String(value);
}

export default function SprintMonthlySavedFields({
  template,
  rows = [],
}) {
  if (!template?.columns?.length) return null;

  return (
    <section
      aria-label="Saved department planning fields"
      style={{
        marginTop: 14,
        marginBottom: 16,
        padding: 16,
        border: '1px solid #dbe3ec',
        borderRadius: 12,
      }}
    >
      <div style={{ marginBottom: 12 }}>
        <strong>
          {template.department} ? Saved Custom Planning Fields
        </strong>
        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
          Original template version {template.version}
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            textAlign: 'left',
          }}
        >
          <thead>
            <tr>
              <th style={{ padding: 8 }}>Activity</th>
              {template.columns.map(column => (
                <th
                  key={column.key}
                  style={{ padding: 8, minWidth: 130 }}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.key || index}>
                <td style={{ padding: 8 }}>
                  {row.activity || `Activity ${index + 1}`}
                </td>
                {template.columns.map(column => (
                  <td
                    key={column.key}
                    style={{ padding: 8, verticalAlign: 'top' }}
                  >
                    {displayValue(
                      row.custom_values?.[column.key],
                      column,
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
