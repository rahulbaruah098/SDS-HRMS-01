// Weekly department fields. File uploads are bound to a saved weekly draft/activity.
import React from 'react';
import { FileText, Info, Layers3 } from 'lucide-react';

const supportedTypes = new Set(['checkbox', 'select', 'textarea', 'number', 'date', 'file']);

function DynamicInput({ column, value, onChange, disabled, id }) {
  const type = supportedTypes.has(column.type) ? column.type : 'text';
  const shared = {
    id,
    disabled,
    className: 'swcf-control',
    'aria-required': column.required ? true : undefined,
  };

  if (type === 'checkbox') {
    return (
      <input
        id={id}
        className="swcf-checkbox"
        type="checkbox"
        checked={value === true}
        disabled={disabled}
        onChange={event => onChange(event.target.checked)}
      />
    );
  }

  if (type === 'select') {
    return (
      <select {...shared} value={value ?? ''} onChange={event => onChange(event.target.value)}>
        <option value="">Select an option</option>
        {(Array.isArray(column.options) ? column.options : []).map((option, index) => (
          <option key={`${String(option)}-${index}`} value={option}>{option}</option>
        ))}
      </select>
    );
  }

  if (type === 'textarea') {
    return (
      <textarea
        {...shared}
        rows={3}
        maxLength={5000}
        value={value ?? ''}
        placeholder={`Enter ${column.label.toLowerCase()}`}
        onChange={event => onChange(event.target.value)}
      />
    );
  }

  return (
    <input
      {...shared}
      type={type === 'number' ? 'number' : type === 'date' ? 'date' : 'text'}
      value={value ?? ''}
      step={type === 'number' ? 'any' : undefined}
      maxLength={type === 'file' ? 1000 : 500}
      placeholder={type === 'file' ? 'Existing attachment reference (if available)' : column.label}
      onChange={event => onChange(event.target.value)}
    />
  );
}

export default function SprintWeeklyCustomFields({
  template,
  activities = [],
  onChange,
  disabled = false,
}) {
  if (!Array.isArray(template?.columns) || template.columns.length === 0) return null;

  const hasFileColumns = template.columns.some(column => column.type === 'file');

  return (
    <section className="swcf-root" aria-label="Weekly department planning fields">
      <style>{`
        .swcf-root {
          min-width: 0; padding: clamp(14px, 2vw, 22px); margin-top: 16px;
          border: 1px solid var(--border, #dbe1e8); border-radius: 14px;
          background: var(--surface, var(--card-bg, #fff)); color: var(--text, inherit);
        }
        .swcf-heading { display: flex; align-items: flex-start; gap: 11px; }
        .swcf-heading-icon { flex: 0 0 auto; padding: 9px; border-radius: 11px;
          background: var(--surface-secondary, #f1f5f9); color: var(--primary, #5142ce); }
        .swcf-title { margin: 0; font-size: clamp(16px, 1.6vw, 19px); line-height: 1.35; }
        .swcf-muted { margin: 5px 0 0; color: var(--text-muted, #64748b); font-size: 13px; line-height: 1.55; }
        .swcf-notice { display: flex; gap: 9px; align-items: flex-start; margin: 15px 0 0;
          padding: 11px 12px; border: 1px solid var(--border, #dbe1e8);
          border-radius: 10px; background: var(--surface-secondary, #f8fafc);
          color: var(--text-muted, #64748b); font-size: 12px; line-height: 1.5; }
        .swcf-notice svg { flex: 0 0 auto; margin-top: 1px; }
        .swcf-activities { display: grid; gap: 13px; margin-top: 18px; }
        .swcf-activity { min-width: 0; border: 1px solid var(--border, #dbe1e8);
          border-radius: 12px; padding: clamp(12px, 1.6vw, 17px); background: var(--surface, #fff); }
        .swcf-activity-head { display: flex; align-items: flex-start; gap: 9px;
          overflow-wrap: anywhere; margin: 0 0 14px; font-size: 14px; }
        .swcf-activity-count { display: inline-flex; align-items: center; justify-content: center;
          flex: 0 0 auto; min-width: 28px; height: 28px; padding: 0 6px; box-sizing: border-box;
          border-radius: 8px; background: var(--surface-secondary, #f1f5f9);
          color: var(--text-muted, #64748b); font-size: 12px; font-weight: 750; }
        .swcf-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); gap: 15px; }
        .swcf-field { min-width: 0; display: block; }
        .swcf-label { display: block; font-size: 13px; font-weight: 650; margin-bottom: 7px;
          color: var(--text, inherit); overflow-wrap: anywhere; }
        .swcf-required { color: var(--danger, #b91c1c); margin-left: 3px; }
        .swcf-control { display: block; width: 100%; min-width: 0; box-sizing: border-box;
          min-height: 43px; padding: 10px 12px; border-radius: 9px;
          border: 1px solid var(--border, #cbd5e1);
          background: var(--surface, var(--card-bg, #fff)); color: var(--text, inherit);
          font: inherit; font-size: 14px; }
        textarea.swcf-control { min-height: 88px; resize: vertical; }
        .swcf-checkbox { width: 20px; height: 20px; margin: 4px 0; cursor: pointer;
          accent-color: var(--primary, #5142ce); }
        .swcf-control:focus-visible, .swcf-checkbox:focus-visible { outline: 2px solid var(--primary, #5142ce);
          outline-offset: 2px; }
        .swcf-control:disabled, .swcf-checkbox:disabled { opacity: .62; cursor: not-allowed; }
        .swcf-help { display: flex; gap: 6px; align-items: flex-start; margin-top: 6px;
          color: var(--text-muted, #64748b); font-size: 12px; line-height: 1.45; }
        .swcf-help svg { flex: 0 0 auto; margin-top: 1px; }
        @media (max-width: 600px) {
          .swcf-root { padding: 13px; }
          .swcf-grid { grid-template-columns: minmax(0, 1fr); gap: 13px; }
          .swcf-activity { padding: 13px; }
        }
      `}</style>
      <div className="swcf-heading">
        <div className="swcf-heading-icon" aria-hidden="true"><Layers3 size={20} /></div>
        <div>
          <h3 className="swcf-title">Department-Specific Weekly Planning Fields</h3>
          <p className="swcf-muted">
            {template.department || 'Department'} · Template version {template.version ?? '—'}
            {' '}· Fields are saved separately for each planned activity.
          </p>
        </div>
      </div>

      {hasFileColumns && (
        <div className="swcf-notice" role="note">
          <Info size={16} aria-hidden="true" />
          <span>
            Save the weekly plan as a draft first. Then open the saved plan below to upload
            files to the correct activity. A file reference may also be entered here if already available;
            this text field does not upload a file. Required attachments are checked on submission.
          </span>
        </div>
      )}

      <div className="swcf-activities">
        {activities.map((activity, index) => (
          <div className="swcf-activity" key={activity.key || index}>
            <div className="swcf-activity-head">
              <span className="swcf-activity-count" aria-hidden="true">{index + 1}</span>
              <strong>{activity.title || 'Untitled activity'}</strong>
            </div>
            <div className="swcf-grid">
              {template.columns.map(column => {
                const id = `swcf-${index}-${String(column.key).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
                const isCheckbox = column.type === 'checkbox';
                return (
                  <div className="swcf-field" key={column.key}>
                    <label className="swcf-label" htmlFor={id}>
                      {column.label}
                      {column.required && <span className="swcf-required" aria-label="required">*</span>}
                    </label>
                    <DynamicInput
                      id={id}
                      column={column}
                      value={activity.custom_values?.[column.key]}
                      disabled={disabled}
                      onChange={value => onChange(index, column.key, value)}
                    />
                    {column.type === 'file' && (
                      <div className="swcf-help">
                        <FileText size={14} aria-hidden="true" />
                        <span>Existing file reference only. Upload new files from the saved draft.</span>
                      </div>
                    )}
                    {isCheckbox && column.required && (
                      <div className="swcf-help">Check this box if the requirement is satisfied.</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
