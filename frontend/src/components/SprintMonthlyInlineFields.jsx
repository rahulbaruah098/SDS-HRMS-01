
import React from 'react';
import {
  ClipboardList,
  FileText,
} from 'lucide-react';

import SprintSavedAttachmentLink from './SprintSavedAttachmentLink';

// Read-only department custom fields for compiled monthly activities.
// The saved template snapshot remains the source of field definitions.
// Backend permissions control access to attachment downloads.

function displayValue(value, column) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return '—';
  }

  if (column.type === 'checkbox') {
    return value === true ? 'Yes' : 'No';
  }

  if (Array.isArray(value)) {
    return value.length
      ? value.map(item => String(item)).join(', ')
      : '—';
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
            ? 'smif-boolean smif-yes'
            : 'smif-boolean'
        }
      >
        {text}
      </span>
    );
  }

  return (
    <span className="smif-value">
      {text}
    </span>
  );
}

export default function SprintMonthlyInlineFields({
  template,
  row,
}) {
  const columns = template?.columns;

  if (!Array.isArray(columns) || columns.length === 0) {
    return (
      <span
        style={{
          fontSize: 12,
          color: 'var(--text-muted, #64748b)',
        }}
      >
        No department fields
      </span>
    );
  }

  return (
    <div
      className="smif-container"
      aria-label="Saved department planning details"
    >
      <style>{`
        .smif-container {
          display: grid;
          gap: 10px;
          min-width: 170px;
          max-width: 100%;
          color: var(--text, inherit);
        }

        .smif-template {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 7px;
          padding-bottom: 9px;
          border-bottom: 1px solid var(--border, #e2e8f0);
          color: var(--text-muted, #64748b);
          font-size: 11px;
          line-height: 1.5;
          overflow-wrap: anywhere;
        }

        .smif-field {
          display: grid;
          gap: 5px;
          min-width: 0;
          padding: 9px 11px;
          border: 1px solid var(--border, #e2e8f0);
          border-radius: 9px;
          background: var(
            --surface-secondary,
            #f8fafc
          );
        }

        .smif-label {
          display: flex;
          align-items: center;
          gap: 6px;
          color: var(--text-muted, #64748b);
          font-size: 11px;
          font-weight: 700;
          line-height: 1.5;
          overflow-wrap: anywhere;
        }

        .smif-content {
          min-width: 0;
          font-size: 12px;
          line-height: 1.6;
          overflow-wrap: anywhere;
        }

        .smif-value {
          display: inline-block;
          max-width: 100%;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }

        .smif-boolean {
          display: inline-flex;
          align-items: center;
          padding: 3px 9px;
          border: 1px solid var(--border, #e2e8f0);
          border-radius: 999px;
          background: var(--surface, #fff);
          font-size: 11px;
          font-weight: 650;
        }

        .smif-yes {
          color: var(--success, #15803d);
        }

        @media (max-width: 480px) {
          .smif-container {
            min-width: 0;
            width: 100%;
          }

          .smif-field {
            padding: 11px;
          }
        }

        @media print {
          .smif-field {
            border-color: #ddd;
            background: transparent;
          }
        }
      `}</style>

      <div className="smif-template">
        <ClipboardList
          size={14}
          aria-hidden="true"
        />

        <span>
          {template.department || 'Department'}
          {' · '}
          Template v{template.version ?? '—'}
        </span>
      </div>

      {columns.map(column => {
        const value =
          row?.custom_values?.[column.key];

        return (
          <div
            key={column.key}
            className="smif-field"
          >
            <div className="smif-label">
              {column.type === 'file' && (
                <FileText
                  size={13}
                  aria-hidden="true"
                />
              )}

              <span>
                {column.label}
              </span>
            </div>

            <div className="smif-content">
              <FieldValue
                column={column}
                value={value}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
