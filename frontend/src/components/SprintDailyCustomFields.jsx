// Department-specific daily reporting fields. Existing field and attachment APIs are preserved.
import { useId } from 'react';
import SprintAttachmentField from './SprintAttachmentField';

const controlStyle = {
  width: '100%',
  minWidth: 0,
  minHeight: 44,
  padding: '10px 12px',
  boxSizing: 'border-box',
  border: '1px solid var(--border, #cbd5e1)',
  borderRadius: 10,
  background: 'var(--surface, var(--card-bg, #fff))',
  color: 'var(--text, inherit)',
  font: 'inherit',
  fontSize: 14,
};

export default function SprintDailyCustomFields({
  template,
  values = {},
  onChange,
  disabled = false,
  planId,
  activityId,
  uploadReady = false,
}) {
  const instanceId = useId();

  if (!Array.isArray(template?.columns) || template.columns.length === 0) {
    return null;
  }

  const columns = template.columns;
  const hasFileFields = columns.some(column => column.type === 'file');
  const filesReady = Boolean(uploadReady && planId && activityId);

  return (
    <section
      className="sprint-daily-custom-fields"
      aria-label="Department daily reporting fields"
    >
      <style>{`
        .sprint-daily-custom-fields {
          min-width: 0;
          padding: clamp(14px, 2.5vw, 20px);
          border: 1px solid var(--border, #dbe1e8);
          border-radius: 14px;
          background: var(--surface, var(--card-bg, #fff));
          color: var(--text, inherit);
        }
        .sprint-daily-custom-fields .sdc-heading {
          margin: 0;
          font-size: clamp(15px, 2vw, 18px);
          line-height: 1.35;
        }
        .sprint-daily-custom-fields .sdc-muted {
          font-size: 12px;
          line-height: 1.6;
          color: var(--text-muted, #64748b);
        }
        .sprint-daily-custom-fields .sdc-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
          gap: 16px;
          margin-top: 16px;
        }
        .sprint-daily-custom-fields .sdc-field {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 7px;
        }
        .sprint-daily-custom-fields .sdc-label {
          font-size: 13px;
          font-weight: 650;
          line-height: 1.45;
        }
        .sprint-daily-custom-fields .sdc-required { color: #b91c1c; }
        .sprint-daily-custom-fields input:focus-visible,
        .sprint-daily-custom-fields select:focus-visible,
        .sprint-daily-custom-fields textarea:focus-visible {
          outline: 2px solid var(--primary, #635bce);
          outline-offset: 2px;
        }
        .sprint-daily-custom-fields .sdc-check {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          min-height: 44px;
          width: fit-content;
          cursor: pointer;
          font-size: 14px;
        }
        .sprint-daily-custom-fields .sdc-check input {
          width: 19px;
          height: 19px;
          flex-shrink: 0;
          accent-color: var(--primary, #635bce);
        }
        .sprint-daily-custom-fields .sdc-file {
          min-width: 0;
          border: 1px solid var(--border, #dbe1e8);
          background: var(--surface-secondary, #f8fafc);
          padding: 12px;
          border-radius: 10px;
        }
        .sprint-daily-custom-fields .sdc-help {
          margin: 8px 0 0;
          font-size: 12px;
          line-height: 1.55;
          color: var(--text-muted, #64748b);
        }
        @media (max-width: 600px) {
          .sprint-daily-custom-fields .sdc-grid { grid-template-columns: minmax(0, 1fr); }
          .sprint-daily-custom-fields .sdc-file { padding: 10px; }
        }
      `}</style>

      <h3 className="sdc-heading">Department Daily Reporting Fields</h3>
      <p className="sdc-muted" style={{ margin: '6px 0 0' }}>
        {template.department || 'Assigned department'}
        {template.version != null ? ` · Template version ${template.version}` : ''}
        {' · '}Complete the required fields before saving your daily work update.
      </p>

      {hasFileFields && !filesReady && (
        <p className="sdc-help" role="status">
          To upload daily attachments, select <strong>Prepare File Uploads</strong> in the
          activity above first. Uploads become available after the daily template is prepared.
        </p>
      )}

      <div className="sdc-grid">
        {columns.map((column, index) => {
          const value = values?.[column.key];
          const id = `${instanceId}-daily-field-${index}`;
          const fieldLabel = `${column.label || column.key}${column.required ? ' (required)' : ''}`;

          if (column.type === 'file') {
            return (
              <div className="sdc-field" key={column.key}>
                <div className="sdc-file">
                  <SprintAttachmentField
                    label={`${column.label}${column.required ? ' *' : ''}`}
                    planType="daily"
                    planId={filesReady ? planId : undefined}
                    activityId={activityId}
                    fieldKey={column.key}
                    value={value || ''}
                    disabled={disabled || !filesReady}
                    onChange={reference => onChange(column.key, reference)}
                  />
                  <p className="sdc-help">
                    {filesReady
                      ? 'After uploading, select Save Daily Work Update to record the attachment with this activity.'
                      : 'Attachment upload is unavailable until you select Prepare File Uploads for this activity.'}
                  </p>
                </div>
              </div>
            );
          }

          if (column.type === 'checkbox') {
            return (
              <div className="sdc-field" key={column.key}>
                <label className="sdc-check" htmlFor={id}>
                  <input
                    id={id}
                    type="checkbox"
                    checked={value === true}
                    disabled={disabled}
                    aria-required={column.required ? 'true' : undefined}
                    onChange={event => onChange(column.key, event.target.checked)}
                  />
                  <span>{column.label}{column.required && <span className="sdc-required"> *</span>}</span>
                </label>
              </div>
            );
          }

          return (
            <div className="sdc-field" key={column.key}>
              <label className="sdc-label" htmlFor={id}>
                {column.label}{column.required && <span className="sdc-required"> *</span>}
              </label>
              {column.type === 'select' ? (
                <select
                  id={id}
                  aria-label={fieldLabel}
                  style={controlStyle}
                  value={value ?? ''}
                  disabled={disabled}
                  required={Boolean(column.required)}
                  onChange={event => onChange(column.key, event.target.value)}
                >
                  <option value="">Select an option</option>
                  {(column.options || []).map(option => (
                    <option key={String(option)} value={option}>{option}</option>
                  ))}
                </select>
              ) : column.type === 'textarea' ? (
                <textarea
                  id={id}
                  aria-label={fieldLabel}
                  style={{ ...controlStyle, minHeight: 88, resize: 'vertical' }}
                  rows={3}
                  value={value ?? ''}
                  disabled={disabled}
                  required={Boolean(column.required)}
                  maxLength={5000}
                  onChange={event => onChange(column.key, event.target.value)}
                />
              ) : (
                <input
                  id={id}
                  aria-label={fieldLabel}
                  style={controlStyle}
                  type={column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text'}
                  step={column.type === 'number' ? 'any' : undefined}
                  maxLength={column.type === 'number' || column.type === 'date' ? undefined : 500}
                  value={value ?? ''}
                  placeholder={column.label}
                  disabled={disabled}
                  required={Boolean(column.required)}
                  onChange={event => onChange(column.key, event.target.value)}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
