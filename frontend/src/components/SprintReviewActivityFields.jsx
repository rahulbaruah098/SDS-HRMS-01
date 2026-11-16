
import React from 'react';
import {
  CalendarRange,
  ClipboardCheck,
  FileText,
} from 'lucide-react';

import SprintSavedAttachmentLink from './SprintSavedAttachmentLink';

// Read-only weekly and daily fields for authorised reviewers.
// Uses saved template snapshots and existing attachment permissions.

function displayValue(value, column) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return 'Not provided';
  }

  if (column.type === 'checkbox') {
    return value === true ? 'Yes' : 'No';
  }

  if (Array.isArray(value)) {
    return value.length
      ? value
          .map(item =>
            typeof item === 'object' && item !== null
              ? JSON.stringify(item)
              : String(item)
          )
          .join(', ')
      : 'Not provided';
  }

  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }

  return String(value);
}

function FieldValue({ column, value }) {
  if (column.type === 'file') {
    return (
      <SprintSavedAttachmentLink
        value={value}
      />
    );
  }

  const text = displayValue(value, column);

  if (column.type === 'checkbox') {
    return (
      <span
        className={
          value === true
            ? 'sraf-boolean sraf-yes'
            : 'sraf-boolean'
        }
      >
        {text}
      </span>
    );
  }

  return (
    <span className="sraf-value">
      {text}
    </span>
  );
}

function FieldList({
  title,
  template,
  values,
  icon: Icon,
}) {
  const columns = template?.columns;

  if (!Array.isArray(columns) || !columns.length) {
    return null;
  }

  return (
    <section className="sraf-card">
      <div className="sraf-card-header">
        <span
          className="sraf-icon"
          aria-hidden="true"
        >
          <Icon size={18} />
        </span>

        <div>
          <h4 className="sraf-title">
            {title}
          </h4>

          <p className="sraf-subtitle">
            {template.department || 'Department'}
            {' · '}
            Template v{template.version ?? 1}
          </p>
        </div>
      </div>

      <dl className="sraf-fields">
        {columns.map(column => {
          const value = values?.[column.key];

          return (
            <div
              className="sraf-field"
              key={column.key}
            >
              <dt className="sraf-label">
                {column.type === 'file' && (
                  <FileText
                    size={14}
                    aria-hidden="true"
                  />
                )}

                <span>
                  {column.label}
                </span>
              </dt>

              <dd className="sraf-content">
                <FieldValue
                  column={column}
                  value={value}
                />
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

export default function SprintReviewActivityFields({
  activity,
  weeklyTemplate,
}) {
  const dailyTemplate =
    activity?.daily_template_snapshot;

  const weeklyValues =
    activity?.custom_values || {};

  const dailyValues =
    activity?.daily_custom_values || {};

  const hasWeekly = Boolean(
    weeklyTemplate?.columns?.length
  );

  const hasDaily = Boolean(
    dailyTemplate?.columns?.length
  );

  if (!hasWeekly && !hasDaily) {
    return null;
  }

  return (
    <div
      className="sraf-container"
      aria-label="Department-specific activity details"
    >
      <style>{`
        .sraf-container {
          display: grid;
          gap: 12px;
          min-width: 0;
          width: 100%;
          box-sizing: border-box;
          margin-top: 12px;
          color: var(--text, inherit);
        }

        .sraf-card {
          min-width: 0;
          padding: clamp(12px, 2vw, 17px);
          border: 1px solid var(--border, #e2e8f0);
          border-radius: 12px;
          background: var(
            --surface,
            var(--card-bg, #fff)
          );
        }

        .sraf-card-header {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 14px;
          padding-bottom: 12px;
          border-bottom: 1px solid var(--border, #e2e8f0);
        }

        .sraf-icon {
          display: grid;
          place-items: center;
          width: 38px;
          height: 38px;
          flex-shrink: 0;
          border-radius: 10px;
          background: var(
            --surface-secondary,
            #f1f5f9
          );
          color: var(--primary, #4f46e5);
        }

        .sraf-title {
          margin: 0;
          font-size: 14px;
          font-weight: 750;
          line-height: 1.4;
        }

        .sraf-subtitle {
          margin: 4px 0 0;
          font-size: 12px;
          line-height: 1.5;
          color: var(--text-muted, #64748b);
        }

        .sraf-fields {
          display: grid;
          grid-template-columns:
            repeat(2, minmax(0, 1fr));
          gap: 12px;
          margin: 0;
        }

        .sraf-field {
          min-width: 0;
          display: grid;
          align-content: start;
          gap: 7px;
          padding: 12px;
          border: 1px solid var(--border, #e2e8f0);
          border-radius: 10px;
          background: var(
            --surface-secondary,
            #f8fafc
          );
        }

        .sraf-label {
          display: flex;
          align-items: center;
          gap: 6px;
          color: var(--text-muted, #64748b);
          font-size: 12px;
          font-weight: 700;
          line-height: 1.5;
          overflow-wrap: anywhere;
        }

        .sraf-content {
          min-width: 0;
          margin: 0;
          font-size: 13px;
          line-height: 1.65;
          overflow-wrap: anywhere;
        }

        .sraf-value {
          display: inline-block;
          max-width: 100%;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }

        .sraf-boolean {
          display: inline-flex;
          align-items: center;
          padding: 4px 10px;
          border-radius: 999px;
          background: var(--surface, #fff);
          border: 1px solid var(--border, #e2e8f0);
          font-size: 12px;
          font-weight: 650;
        }

        .sraf-yes {
          color: var(--success, #15803d);
        }

        @media (max-width: 600px) {
          .sraf-fields {
            grid-template-columns: minmax(0, 1fr);
          }

          .sraf-card-header {
            align-items: flex-start;
          }
        }

        @media print {
          .sraf-card,
          .sraf-field {
            box-shadow: none;
            border-color: #ddd;
          }
        }
      `}</style>

      {hasWeekly && (
        <FieldList
          title="Weekly Planning Fields"
          template={weeklyTemplate}
          values={weeklyValues}
          icon={CalendarRange}
        />
      )}

      {hasDaily && (
        <FieldList
          title="Daily Work Report Fields"
          template={dailyTemplate}
          values={dailyValues}
          icon={ClipboardCheck}
        />
      )}
    </div>
  );
}
