
import React from 'react';
import { ClipboardList, FileText, Layers3 } from 'lucide-react';
import SprintSavedAttachmentLink from './SprintSavedAttachmentLink';

// Read-only department fields from the saved monthly template snapshot.
// Never modify saved values or template definitions here.

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

function SavedValue({ column, value }) {
  if (column.type === 'file') {
    return <SprintSavedAttachmentLink value={value} />;
  }

  const text = displayValue(value, column);

  if (column.type === 'checkbox') {
    return (
      <span
        className={
          value === true
            ? 'smsf-boolean smsf-yes'
            : 'smsf-boolean'
        }
      >
        {text}
      </span>
    );
  }

  return (
    <span className="smsf-value">
      {text}
    </span>
  );
}

export default function SprintMonthlySavedFields({
  template,
  rows = [],
}) {
  if (!template?.columns?.length) {
    return null;
  }

  const columns = template.columns;
  const activities = Array.isArray(rows) ? rows : [];

  return (
    <section
      className="smsf-section"
      aria-label="Saved department planning fields"
    >
      <style>{`
        .smsf-section {
          width: 100%;
          min-width: 0;
          box-sizing: border-box;
          margin: 18px 0;
          padding: clamp(14px, 2vw, 22px);
          border: 1px solid var(--border, #dbe3ec);
          border-radius: 14px;
          background: var(
            --surface,
            var(--card-bg, #ffffff)
          );
          color: var(--text, inherit);
        }

        .smsf-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
          margin-bottom: 18px;
        }

        .smsf-heading {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }

        .smsf-heading-icon {
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

        .smsf-title {
          margin: 0;
          font-size: clamp(15px, 2vw, 17px);
          font-weight: 750;
          line-height: 1.4;
          overflow-wrap: anywhere;
        }

        .smsf-subtitle {
          margin: 5px 0 0;
          color: var(--text-muted, #64748b);
          font-size: 12px;
          line-height: 1.6;
        }

        .smsf-meta {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 11px;
          border: 1px solid var(--border, #e2e8f0);
          border-radius: 999px;
          background: var(
            --surface-secondary,
            #f8fafc
          );
          color: var(--text-muted, #64748b);
          font-size: 12px;
          font-weight: 650;
          white-space: nowrap;
        }

        .smsf-scroll {
          width: 100%;
          min-width: 0;
          overflow-x: auto;
          border: 1px solid var(--border, #e2e8f0);
          border-radius: 11px;
        }

        .smsf-table {
          width: 100%;
          min-width: 650px;
          border-spacing: 0;
          border-collapse: separate;
          text-align: left;
          font-size: 13px;
        }

        .smsf-table th {
          padding: 13px;
          background: var(
            --surface-secondary,
            #f8fafc
          );
          color: var(--text-muted, #475569);
          font-size: 12px;
          font-weight: 750;
          border-bottom: 1px solid var(--border, #e2e8f0);
          white-space: nowrap;
          vertical-align: top;
        }

        .smsf-table td {
          padding: 13px;
          border-bottom: 1px solid var(--border, #edf2f7);
          vertical-align: top;
          overflow-wrap: anywhere;
          max-width: 300px;
        }

        .smsf-table tbody tr:last-child td {
          border-bottom: none;
        }

        .smsf-table tbody tr:hover {
          background: var(
            --surface-secondary,
            #f8fafc
          );
        }

        .smsf-table .smsf-activity {
          min-width: 180px;
          font-weight: 700;
        }

        .smsf-value {
          display: inline-block;
          max-width: 100%;
          overflow-wrap: anywhere;
          white-space: pre-wrap;
          line-height: 1.55;
        }

        .smsf-boolean {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 4px 10px;
          border-radius: 999px;
          background: var(
            --surface-secondary,
            #f1f5f9
          );
          border: 1px solid var(--border, #e2e8f0);
          font-size: 12px;
          font-weight: 650;
        }

        .smsf-yes {
          color: var(--success, #15803d);
        }

        .smsf-mobile-list {
          display: none;
        }

        .smsf-card {
          min-width: 0;
          padding: 14px;
          border: 1px solid var(--border, #e2e8f0);
          border-radius: 11px;
          background: var(
            --surface,
            var(--card-bg, #fff)
          );
        }

        .smsf-card-heading {
          display: flex;
          align-items: flex-start;
          gap: 9px;
          padding-bottom: 12px;
          margin-bottom: 12px;
          border-bottom: 1px solid var(--border, #e2e8f0);
        }

        .smsf-card-title {
          font-weight: 750;
          font-size: 13px;
          line-height: 1.5;
          overflow-wrap: anywhere;
        }

        .smsf-field-grid {
          display: grid;
          grid-template-columns:
            repeat(2, minmax(0, 1fr));
          gap: 15px;
        }

        .smsf-field {
          display: grid;
          align-content: start;
          gap: 5px;
          min-width: 0;
        }

        .smsf-field-label {
          color: var(--text-muted, #64748b);
          font-size: 11px;
          font-weight: 700;
          line-height: 1.5;
          overflow-wrap: anywhere;
        }

        .smsf-field-content {
          font-size: 13px;
          line-height: 1.6;
          overflow-wrap: anywhere;
          min-width: 0;
        }

        .smsf-empty {
          padding: 20px;
          text-align: center;
          color: var(--text-muted, #64748b);
          font-size: 13px;
        }

        @media (max-width: 768px) {
          .smsf-scroll {
            display: none;
          }

          .smsf-mobile-list {
            display: grid;
            gap: 12px;
          }
        }

        @media (max-width: 480px) {
          .smsf-field-grid {
            grid-template-columns: minmax(0, 1fr);
          }

          .smsf-header {
            flex-direction: column;
          }

          .smsf-meta {
            white-space: normal;
          }
        }

        @media print {
          .smsf-section {
            box-shadow: none;
            border-color: #ccc;
          }

          .smsf-scroll {
            display: block;
            overflow: visible;
          }

          .smsf-mobile-list {
            display: none;
          }

          .smsf-table {
            font-size: 10px;
          }

          .smsf-table th,
          .smsf-table td {
            padding: 6px;
          }
        }
      `}</style>

      <div className="smsf-header">
        <div className="smsf-heading">
          <span
            className="smsf-heading-icon"
            aria-hidden="true"
          >
            <ClipboardList size={19} />
          </span>

          <div>
            <h3 className="smsf-title">
              {template.department || 'Department'}
              {' — '}
              Saved Planning Fields
            </h3>

            <p className="smsf-subtitle">
              These values belong to the original
              saved monthly planning template.
            </p>
          </div>
        </div>

        <div className="smsf-meta">
          <Layers3 size={14} aria-hidden="true" />
          <span>
            Template Version {template.version ?? '—'}
          </span>
        </div>
      </div>

      {activities.length === 0 ? (
        <div className="smsf-empty">
          No saved activity values are available.
        </div>
      ) : (
        <>
          {/* Desktop and tablet table view */}
          <div
            className="smsf-scroll"
            role="region"
            aria-label="Saved department fields table"
            tabIndex={0}
          >
            <table className="smsf-table">
              <thead>
                <tr>
                  <th scope="col">Activity</th>

                  {columns.map(column => (
                    <th
                      scope="col"
                      key={column.key}
                      style={{ minWidth: 150 }}
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {activities.map((row, index) => (
                  <tr
                    key={row.row_id || row.key || index}
                  >
                    <td className="smsf-activity">
                      {row.activity ||
                        `Activity ${index + 1}`}
                    </td>

                    {columns.map(column => (
                      <td key={column.key}>
                        <SavedValue
                          column={column}
                          value={
                            row.custom_values?.[
                              column.key
                            ]
                          }
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile activity-card view */}
          <div className="smsf-mobile-list">
            {activities.map((row, index) => (
              <article
                className="smsf-card"
                key={row.row_id || row.key || index}
              >
                <div className="smsf-card-heading">
                  <FileText
                    size={18}
                    style={{ flexShrink: 0 }}
                    aria-hidden="true"
                  />

                  <div className="smsf-card-title">
                    Activity {index + 1}
                    <div style={{
                      fontWeight: 500,
                      marginTop: 3
                    }}>
                      {row.activity || 'Untitled activity'}
                    </div>
                  </div>
                </div>

                <div className="smsf-field-grid">
                  {columns.map(column => (
                    <div
                      className="smsf-field"
                      key={column.key}
                    >
                      <div className="smsf-field-label">
                        {column.label}
                      </div>

                      <div className="smsf-field-content">
                        <SavedValue
                          column={column}
                          value={
                            row.custom_values?.[
                              column.key
                            ]
                          }
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
