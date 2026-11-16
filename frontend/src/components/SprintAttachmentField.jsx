
import React, { useEffect, useId, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileUp,
  Paperclip,
  UploadCloud,
} from 'lucide-react';

import {
  uploadSprintAttachment,
  sprintAttachmentReference,
  downloadSprintAttachment,
} from '../api/sprintPlanning';

// Reusable attachment field for saved monthly, weekly and daily Sprint activities.
// Parent forms remain responsible for persisting the returned custom-field reference.

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const REFERENCE_PATTERN = /^sprint-attachment:[0-9a-f]{32}$/;
const ATTACHMENT_ID_PATTERN = /^[0-9a-f]{32}$/;

export default function SprintAttachmentField({
  label = 'Supporting file',
  planType,
  planId,
  rowId,
  activityId,
  fieldKey,
  value = '',
  disabled = false,
  onChange,
}) {
  const inputId = useId();
  const inputRef = useRef(null);

  const [selected, setSelected] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [lastName, setLastName] = useState('');

  const hasPlan = Boolean(
    planId &&
    fieldKey &&
    (
      (planType === 'monthly' && rowId) ||
      (
        (planType === 'weekly' || planType === 'daily') &&
        activityId
      )
    )
  );

  const validReference =
    typeof value === 'string' &&
    REFERENCE_PATTERN.test(value);

  const isWorking = uploading || downloading;
  const canChoose = hasPlan && !disabled && !isWorking;

  // Clear pending selections when switching plans or activities.
  useEffect(() => {
    setSelected(null);
    setLastName('');
    setError('');
    setMessage('');

    if (inputRef.current) {
      inputRef.current.value = '';
    }
  }, [planType, planId, rowId, activityId, fieldKey]);

  async function upload() {
    if (!selected || !canChoose) return;

    setError('');
    setMessage('');

    if (!selected.size) {
      setError(
        'The selected file is empty. Please select a different file.'
      );
      return;
    }

    if (selected.size > MAX_FILE_BYTES) {
      setError(
        'The maximum file size is 10 MB. Choose a smaller file.'
      );
      return;
    }

    if (typeof onChange !== 'function') {
      setError(
        'This form cannot save the attachment reference.'
      );
      return;
    }

    setUploading(true);

    try {
      const result = await uploadSprintAttachment({
        planType,
        planId,
        rowId,
        activityId,
        fieldKey,
        file: selected,
      });

      const attachmentId = result?.attachment_id;

      if (
        typeof attachmentId !== 'string' ||
        !ATTACHMENT_ID_PATTERN.test(attachmentId)
      ) {
        throw new Error(
          'The upload response did not contain a valid attachment ID.'
        );
      }

      const reference = sprintAttachmentReference(attachmentId);

      if (
        typeof reference !== 'string' ||
        !REFERENCE_PATTERN.test(reference)
      ) {
        throw new Error(
          'The uploaded attachment reference is invalid.'
        );
      }

      // Weekly forms may save through a separate API call.
      // Monthly and daily forms may persist on parent form save.
      await Promise.resolve(onChange(reference, result));

      setLastName(selected.name);
      setSelected(null);

      if (inputRef.current) {
        inputRef.current.value = '';
      }

      setMessage(
        'Upload complete. Save the plan or daily update if the form requires it.'
      );
    } catch (err) {
      setError(
        err?.message || 'Unable to upload this file. Please retry.'
      );
    } finally {
      setUploading(false);
    }
  }

  async function downloadExisting() {
    if (!validReference || isWorking) return;

    setError('');
    setMessage('');
    setDownloading(true);

    try {
      const attachmentId = value.slice(
        'sprint-attachment:'.length
      );

      await downloadSprintAttachment(
        attachmentId,
        lastName
      );
    } catch (err) {
      setError(
        err?.message || 'Unable to download this file. Please retry.'
      );
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div
      className="sprint-attachment-field"
      aria-busy={isWorking}
    >
      <style>{`
        .sprint-attachment-field {
          min-width: 0;
          display: grid;
          gap: 10px;
          color: var(--text, inherit);
        }

        .sprint-attachment-field .saf-heading {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          font-weight: 700;
          min-width: 0;
          overflow-wrap: anywhere;
        }

        .sprint-attachment-field .saf-caption {
          font-size: 12px;
          line-height: 1.6;
          color: var(--text-muted, #64748b);
          margin: 0;
        }

        .sprint-attachment-field .saf-box {
          min-width: 0;
          padding: 13px;
          border: 1px solid var(--border, #dbe1e8);
          border-radius: 12px;
          background: var(
            --surface-secondary,
            var(--card-bg, #f8fafc)
          );
        }

        .sprint-attachment-field .saf-file {
          display: block;
          box-sizing: border-box;
          width: 100%;
          min-width: 0;
          padding: 10px;
          border: 1px dashed var(--border, #cbd5e1);
          border-radius: 9px;
          background: var(
            --surface,
            var(--card-bg, #fff)
          );
          color: inherit;
          font: inherit;
          font-size: 13px;
        }

        .sprint-attachment-field .saf-file::file-selector-button {
          margin-right: 12px;
          border: 1px solid var(--border, #cbd5e1);
          border-radius: 7px;
          padding: 8px 12px;
          background: var(--surface-secondary, #f1f5f9);
          color: inherit;
          cursor: pointer;
          font: inherit;
        }

        .sprint-attachment-field .saf-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-height: 42px;
          max-width: 100%;
          border: 1px solid var(--border, #cbd5e1);
          border-radius: 9px;
          padding: 9px 14px;
          font: inherit;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          background: var(
            --surface,
            var(--card-bg, #fff)
          );
          color: inherit;
        }

        .sprint-attachment-field .saf-button-primary {
          border-color: var(--primary, #4f46e5);
          background: var(--primary, #4f46e5);
          color: #fff;
        }

        .sprint-attachment-field .saf-button:disabled {
          opacity: .55;
          cursor: not-allowed;
        }

        .sprint-attachment-field .saf-file:focus-visible,
        .sprint-attachment-field .saf-button:focus-visible {
          outline: 3px solid var(--primary, #4f46e5);
          outline-offset: 2px;
        }

        .sprint-attachment-field .saf-status {
          display: flex;
          align-items: flex-start;
          gap: 7px;
          margin: 0;
          font-size: 12px;
          line-height: 1.5;
          overflow-wrap: anywhere;
        }

        .sprint-attachment-field .saf-ok {
          color: var(--success, #047857);
        }

        .sprint-attachment-field .saf-error {
          color: var(--danger, #b91c1c);
        }

        .sprint-attachment-field .saf-warning {
          color: var(--warning, #92400e);
        }

        @media (max-width: 480px) {
          .sprint-attachment-field .saf-button {
            width: 100%;
          }
        }
      `}</style>

      <label
        className="saf-heading"
        htmlFor={inputId}
      >
        <Paperclip size={16} aria-hidden="true" />
        <span>{label}</span>
      </label>

      {validReference && (
        <div
          className="saf-box"
          style={{ display: 'grid', gap: 8 }}
        >
          <p className="saf-status saf-ok">
            <CheckCircle2
              size={16}
              aria-hidden="true"
            />
            <span>
              Attachment reference available
              {lastName ? `: ${lastName}` : ''}
            </span>
          </p>

          <button
            type="button"
            className="saf-button"
            disabled={isWorking}
            onClick={downloadExisting}
          >
            <Download
              size={16}
              aria-hidden="true"
            />
            {downloading
              ? 'Downloading…'
              : 'Download existing file'}
          </button>
        </div>
      )}

      {!hasPlan && (
        <p className="saf-status saf-warning">
          <AlertCircle
            size={16}
            aria-hidden="true"
          />
          <span>
            {planType === 'daily'
              ? 'Select Prepare File Uploads in the daily work form before choosing a file.'
              : 'Save the plan as a draft before uploading. The saved activity needs its own ID.'}
          </span>
        </p>
      )}

      <div
        className="saf-box"
        style={{ display: 'grid', gap: 10 }}
      >
        <input
          ref={inputRef}
          id={inputId}
          className="saf-file"
          type="file"
          disabled={!canChoose}
          aria-describedby={`${inputId}-help`}
          onChange={event => {
            const file = event.target.files?.[0] || null;

            setSelected(file);
            setError('');
            setMessage('');

            if (file && file.size > MAX_FILE_BYTES) {
              setError(
                'The maximum file size is 10 MB. Choose a smaller file.'
              );
            } else if (file && file.size === 0) {
              setError(
                'The selected file is empty. Please select a different file.'
              );
            }
          }}
        />

        <p
          id={`${inputId}-help`}
          className="saf-caption"
        >
          Maximum file size: 10 MB.
          Accepted file types are checked by the server.
        </p>

        <button
          type="button"
          className="saf-button saf-button-primary"
          disabled={
            !canChoose ||
            !selected ||
            selected.size === 0 ||
            selected.size > MAX_FILE_BYTES ||
            typeof onChange !== 'function'
          }
          onClick={upload}
        >
          <UploadCloud
            size={16}
            aria-hidden="true"
          />
          {uploading
            ? 'Uploading…'
            : 'Upload selected file'}
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="saf-status saf-error"
        >
          <AlertCircle
            size={16}
            aria-hidden="true"
          />
          <span>{error}</span>
        </p>
      )}

      {message && !error && (
        <p
          role="status"
          className="saf-status saf-ok"
        >
          <FileUp
            size={16}
            aria-hidden="true"
          />
          <span>{message}</span>
        </p>
      )}
    </div>
  );
}
