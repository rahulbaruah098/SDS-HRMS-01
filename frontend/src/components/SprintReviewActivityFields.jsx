// STEP 44B.53E.12 - Read-only weekly/daily reviewer fields
import React from 'react';

function displayValue(value, column) {
  if (value === null || value === undefined || value === '') {
    return 'Not provided';
  }

  if (column.type === 'checkbox') {
    return value === true ? 'Yes' : 'No';
  }

  if (Array.isArray(value)) {
    return value.join(', ');
  }

  if (typeof value === 'object') {
    return 'Structured value recorded';
  }

  return String(value);
}

function FieldList({ title, template, values }) {
  const columns = template?.columns;

  if (!Array.isArray(columns) || !columns.length) {
    return null;
  }

  return (
    <div style={{
      border: '1px solid var(--border, #e2e8f0)',
      borderRadius: 8,
      padding: 10,
      marginTop: 10,
    }}>
      <strong style={{ fontSize: 13 }}>{title}</strong>

      <p style={{
        margin: '4px 0 8px',
        fontSize: 12,
        opacity: 0.75,
      }}>
        {template.department || 'Department'} ?
        {' '}Template version {template.version || 1}
      </p>

      <dl style={{ margin: 0 }}>
        {columns.map(column => (
          <div key={column.key} style={{
            marginBottom: 8,
            overflowWrap: 'anywhere',
          }}>
            <dt style={{ fontSize: 12, fontWeight: 600 }}>
              {column.label}
            </dt>
            <dd style={{ margin: '2px 0 0', fontSize: 13 }}>
              {displayValue(
                values?.[column.key],
                column
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function SprintReviewActivityFields({
  activity,
  weeklyTemplate,
}) {
  const dailyTemplate = activity?.daily_template_snapshot;

  const weeklyValues = activity?.custom_values || {};
  const dailyValues = activity?.daily_custom_values || {};

  const hasWeekly = Boolean(weeklyTemplate?.columns?.length);
  const hasDaily = Boolean(dailyTemplate?.columns?.length);

  if (!hasWeekly && !hasDaily) return null;

  return (
    <div aria-label="Department-specific activity details">
      <FieldList
        title="Weekly Planning Fields"
        template={weeklyTemplate}
        values={weeklyValues}
      />

      <FieldList
        title="Daily Work Report Fields"
        template={dailyTemplate}
        values={dailyValues}
      />
    </div>
  );
}
