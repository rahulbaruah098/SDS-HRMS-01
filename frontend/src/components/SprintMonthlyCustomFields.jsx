// Department-specific monthly fields. The parent owns draft persistence and template snapshots.
import SprintAttachmentField from './SprintAttachmentField';

const toText = (value) => value == null ? '' : String(value);

function renderField(column, value, onChange, disabled, id) {
  const common = {
    id,
    disabled,
    'aria-label': column.label,
    className: 'smcf-input',
  };

  if (column.type === 'checkbox') {
    return (
      <input
        id={id}
        className="smcf-checkbox"
        type="checkbox"
        disabled={disabled}
        checked={value === true}
        onChange={(event) => onChange(event.target.checked)}
      />
    );
  }

  if (column.type === 'select') {
    return (
      <select {...common} value={toText(value)} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select an option</option>
        {(Array.isArray(column.options) ? column.options : []).map((option, index) => {
          const optionValue = typeof option === 'object' && option !== null
            ? toText(option.value ?? option.label)
            : toText(option);
          const optionLabel = typeof option === 'object' && option !== null
            ? toText(option.label ?? option.value)
            : toText(option);
          return <option key={`${optionValue}-${index}`} value={optionValue}>{optionLabel}</option>;
        })}
      </select>
    );
  }

  if (column.type === 'textarea') {
    return (
      <textarea {...common} rows={3} maxLength={5000}
        value={toText(value)} onChange={(event) => onChange(event.target.value)} />
    );
  }

  return (
    <input
      {...common}
      type={column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text'}
      step={column.type === 'number' ? 'any' : undefined}
      maxLength={column.type === 'number' || column.type === 'date' ? undefined : 500}
      placeholder={column.label}
      value={toText(value)}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export default function SprintMonthlyCustomFields({
  template,
  rows,
  onChange,
  disabled = false,
  planId = '',
}) {
  if (!Array.isArray(template?.columns) || template.columns.length === 0) return null;

  const activities = Array.isArray(rows) ? rows : [];
  const fileFields = template.columns.filter(column => column.type === 'file');

  return (
    <section className="smcf-root" aria-label="Department-specific monthly planning fields">
      <style>{`
        .smcf-root { min-width: 0; margin-top: 16px; padding: clamp(14px, 2vw, 22px);
          background: var(--card-bg, var(--surface, #fff)); color: var(--text, inherit);
          border: 1px solid var(--border, #e2e8f0); border-radius: 16px; }
        .smcf-root * { box-sizing: border-box; }
        .smcf-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
        .smcf-heading h3 { margin: 0; font-size: clamp(16px, 2vw, 19px); line-height: 1.4; overflow-wrap: anywhere; }
        .smcf-muted { color: var(--text-muted, #64748b); font-size: 13px; line-height: 1.55; margin: 6px 0 0; }
        .smcf-version { font-size: 12px; font-weight: 650; color: var(--text-muted, #64748b);
          background: var(--surface-secondary, #f8fafc); border: 1px solid var(--border, #e2e8f0);
          border-radius: 999px; padding: 6px 10px; white-space: nowrap; }
        .smcf-activity { min-width: 0; margin-top: 16px; padding: clamp(12px, 1.8vw, 18px);
          border: 1px solid var(--border, #e2e8f0); border-radius: 12px;
          background: var(--surface-secondary, var(--card-bg, #fff)); }
        .smcf-activity-title { display: flex; gap: 9px; align-items: baseline; flex-wrap: wrap;
          font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; }
        .smcf-activity-title strong { font-size: 14px; }
        .smcf-row-num { color: var(--text-muted, #64748b); font-size: 12px; font-weight: 700; }
        .smcf-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
          gap: 16px; margin-top: 15px; }
        .smcf-field { display: flex; min-width: 0; flex-direction: column; gap: 7px; }
        .smcf-label { color: var(--text, inherit); font-size: 13px; font-weight: 650; line-height: 1.4; overflow-wrap: anywhere; }
        .smcf-required { color: #b91c1c; font-weight: 800; margin-left: 3px; }
        .smcf-input { display: block; width: 100%; min-width: 0; min-height: 42px;
          border: 1px solid var(--border, #cbd5e1); background: var(--surface, var(--card-bg, #fff));
          color: var(--text, inherit); border-radius: 9px; padding: 10px 12px; font: inherit; font-size: 14px; }
        textarea.smcf-input { resize: vertical; min-height: 88px; }
        .smcf-input:focus-visible, .smcf-checkbox:focus-visible {
          outline: 2px solid var(--primary, #5142ce); outline-offset: 2px; }
        .smcf-input:disabled, .smcf-checkbox:disabled { opacity: .6; cursor: not-allowed; }
        .smcf-checkbox { width: 20px; height: 20px; margin: 3px 0; accent-color: var(--primary, #5142ce); }
        .smcf-file-help { margin: 5px 0 0; font-size: 12px; line-height: 1.55; color: var(--text-muted, #64748b); }
        .smcf-note { padding-top: 14px; margin-top: 16px; border-top: 1px solid var(--border, #e2e8f0); }
        @media (max-width: 600px) {
          .smcf-root { padding: 13px; border-radius: 12px; }
          .smcf-activity { padding: 12px; }
          .smcf-fields { grid-template-columns: minmax(0, 1fr); gap: 14px; }
          .smcf-version { white-space: normal; }
        }
        @media (prefers-reduced-motion: reduce) { .smcf-root * { scroll-behavior: auto; } }
      `}</style>
      <div className="smcf-heading">
        <div>
          <h3>{template.department || 'Department'} — Custom Monthly Planning Fields</h3>
          <p className="smcf-muted">These fields belong to individual activity rows and use the saved department template.</p>
        </div>
        {template.version != null && <span className="smcf-version">Template v{template.version}</span>}
      </div>

      {fileFields.length > 0 && !planId && (
        <p className="smcf-muted" role="note">
          To attach files, first save this monthly plan as a draft. Then open the saved plan for editing and upload files to its saved activity rows before submitting for approval.
        </p>
      )}

      {activities.map((row, rowIndex) => (
        <section key={row.key || row.row_id || rowIndex} className="smcf-activity"
          aria-label={`Custom fields for activity ${rowIndex + 1}`}>
          <div className="smcf-activity-title">
            <span className="smcf-row-num">Activity {rowIndex + 1}</span>
            <strong>{row.activity || 'Untitled activity'}</strong>
          </div>
          <div className="smcf-fields">
            {template.columns.map((column, columnIndex) => {
              const fieldId = `sprint-custom-${rowIndex}-${columnIndex}`;
              const value = row.custom_values?.[column.key];

              if (column.type === 'file') {
                return (
                  <div key={column.key} className="smcf-field">
                    <SprintAttachmentField
                      label={`${column.label}${column.required ? ' *' : ''}`}
                      planType="monthly"
                      planId={planId}
                      rowId={row.row_id}
                      fieldKey={column.key}
                      value={value || ''}
                      disabled={disabled || !planId || !row.row_id}
                      onChange={(reference) => onChange(row.key, column.key, reference)}
                    />
                    {!planId && (
                      <p className="smcf-file-help">Save this sheet as a draft to enable attachment uploads.</p>
                    )}
                    {planId && !row.row_id && (
                      <p className="smcf-file-help" role="status">
                        This row does not have a saved ID. File upload is unavailable until its row identity is established.
                      </p>
                    )}
                    {planId && row.row_id && (
                      <p className="smcf-file-help">After uploading, save the monthly sheet to retain the file reference.</p>
                    )}
                  </div>
                );
              }

              return (
                <div className="smcf-field" key={column.key}>
                  <label htmlFor={fieldId} className="smcf-label">
                    {column.label}{column.required && <span className="smcf-required" aria-label="required">*</span>}
                  </label>
                  {renderField(column, value,
                    (next) => onChange(row.key, column.key, next), disabled, fieldId)}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <p className="smcf-muted smcf-note">
        Complete all required text, number, date and selection fields before saving. Required file attachments must be uploaded to the saved draft before submission. Standard Objective, Activity, KPI and Weightage checks still apply.
      </p>
    </section>
  );
}
