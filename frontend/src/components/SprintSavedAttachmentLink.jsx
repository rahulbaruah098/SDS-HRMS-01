
import React, { useState } from 'react';
import {
  Download,
  FileText,
  AlertCircle,
  LoaderCircle,
} from 'lucide-react';

import {
  downloadSprintAttachment,
} from '../api/sprintPlanning';

// Read-only attachment download component.
// The backend remains responsible for authentication,
// tenant isolation and file-access permissions.

const ATTACHMENT_PATTERN =
  /^sprint-attachment:[0-9a-f]{32}$/;

export default function SprintSavedAttachmentLink({
  value,
}) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  const valid =
    typeof value === 'string' &&
    ATTACHMENT_PATTERN.test(value);

  async function handleDownload() {
    if (!valid || downloading) return;

    setError('');
    setDownloading(true);

    try {
      const attachmentId = value.slice(
        'sprint-attachment:'.length
      );

      await downloadSprintAttachment(attachmentId);
    } catch (err) {
      setError(
        err?.message ||
        'Unable to download the attachment. Please try again.'
      );
    } finally {
      setDownloading(false);
    }
  }

  if (!valid) {
    return (
      <span
        className="ssal-empty"
        title={
          value
            ? 'Invalid attachment reference'
            : 'No attachment provided'
        }
        style={{
          fontSize: 12,
          color: value
            ? 'var(--danger, #b91c1c)'
            : 'var(--text-muted, #64748b)',
          overflowWrap: 'anywhere',
        }}
      >
        {value
          ? 'Invalid file reference'
          : 'Not provided'}
      </span>
    );
  }

  return (
    <span className="ssal-container">
      <style>{`
        .ssal-container {
          display: inline-grid;
          gap: 7px;
          min-width: 0;
          max-width: 100%;
          vertical-align: middle;
        }

        .ssal-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-height: 40px;
          padding: 9px 13px;
          max-width: 100%;
          border: 1px solid var(--border, #dbe1e8);
          border-radius: 9px;
          background: var(
            --surface,
            var(--card-bg, #fff)
          );
          color: var(--primary, #4f46e5);
          font: inherit;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          transition:
            border-color .15s ease,
            background-color .15s ease;
        }

        .ssal-button:hover:not(:disabled) {
          background: var(
            --surface-secondary,
            #f8fafc
          );
          border-color: var(--primary, #4f46e5);
        }

        .ssal-button:focus-visible {
          outline: 3px solid var(--primary, #4f46e5);
          outline-offset: 2px;
        }

        .ssal-button:disabled {
          opacity: .6;
          cursor: not-allowed;
        }

        .ssal-message {
          display: flex;
          align-items: flex-start;
          gap: 6px;
          color: var(--danger, #b91c1c);
          font-size: 12px;
          line-height: 1.5;
          overflow-wrap: anywhere;
        }

        @media (max-width: 480px) {
          .ssal-container {
            width: 100%;
          }

          .ssal-button {
            width: 100%;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .ssal-button {
            transition: none;
          }
        }
      `}</style>

      <button
        type="button"
        className="ssal-button"
        onClick={handleDownload}
        disabled={downloading}
        aria-label="Download saved Sprint attachment"
        aria-busy={downloading}
      >
        {downloading ? (
          <LoaderCircle
            size={16}
            aria-hidden="true"
          />
        ) : (
          <Download
            size={16}
            aria-hidden="true"
          />
        )}

        <span>
          {downloading
            ? 'Downloading...'
            : 'Download File'}
        </span>

        {!downloading && (
          <FileText
            size={14}
            aria-hidden="true"
          />
        )}
      </button>

      {error && (
        <span
          className="ssal-message"
          role="alert"
        >
          <AlertCircle
            size={15}
            style={{ flexShrink: 0 }}
            aria-hidden="true"
          />
          <span>{error}</span>
        </span>
      )}
    </span>
  );
}
