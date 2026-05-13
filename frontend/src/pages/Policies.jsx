import React, { useEffect, useMemo, useState } from 'react';
import {
  Upload,
  FileText,
  Download,
  Search,
  RefreshCw,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  X,
} from 'lucide-react';

import {
  getPolicies,
  uploadPolicy,
  downloadPolicy,
} from '../api/client';

const HR_UPLOAD_ROLES = ['hr', 'hr_admin', 'hr_manager'];

const ACCEPTED_FILE_TYPES = '.pdf,.docx,.jpg,.jpeg,.png,.webp';

function getUserRoles(user) {
  const roles = [];

  if (user?.role) {
    roles.push(user.role);
  }

  if (Array.isArray(user?.roles)) {
    roles.push(...user.roles);
  }

  if (Array.isArray(user?.effective_roles)) {
    roles.push(...user.effective_roles);
  }

  return [...new Set(roles.filter(Boolean).map((role) => String(role).toLowerCase()))];
}

function canUploadPolicy(user) {
  const roles = getUserRoles(user);
  return roles.some((role) => HR_UPLOAD_ROLES.includes(role));
}

function formatFileSize(size) {
  const bytes = Number(size || 0);

  if (!bytes) {
    return 'File';
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileBadge(policy) {
  const ext = String(policy?.file_extension || '').toUpperCase();

  if (!ext) {
    return 'DOC';
  }

  return ext;
}

function formatDate(value) {
  if (!value) {
    return '—';
  }

  try {
    return new Date(value).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}

export default function Policies({ user }) {
  const allowUpload = canUploadPolicy(user);

  const [policies, setPolicies] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [downloadingId, setDownloadingId] = useState('');
  const [message, setMessage] = useState(null);

  const [form, setForm] = useState({
    document_id: '',
    title: '',
    summary: '',
    file: null,
  });

  const filteredPolicies = useMemo(() => {
    const term = search.trim().toLowerCase();

    if (!term) {
      return policies;
    }

    return policies.filter((policy) => {
      return [
        policy.document_id,
        policy.title,
        policy.summary,
        policy.file_original_name,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });
  }, [policies, search]);

  async function loadPolicies() {
    setLoading(true);

    try {
      const data = await getPolicies({
        limit: 100,
      });

      setPolicies(data.items || data.policies || []);
    } catch (error) {
      setMessage({
        type: 'error',
        text: error?.message || 'Unable to load policies.',
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPolicies();
  }, []);

  function updateForm(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function resetForm() {
    setForm({
      document_id: '',
      title: '',
      summary: '',
      file: null,
    });

    const input = document.getElementById('policy-file-input');

    if (input) {
      input.value = '';
    }
  }

  function validateForm() {
    if (!form.document_id.trim()) {
      return 'Document ID Number is required.';
    }

    if (!form.title.trim()) {
      return 'Policy title is required.';
    }

    if (!form.summary.trim()) {
      return 'Policy summary is required.';
    }

    if (!form.file) {
      return 'Policy file is required.';
    }

    const allowedExtensions = ['pdf', 'docx', 'jpg', 'jpeg', 'png', 'webp'];
    const fileName = form.file.name || '';
    const extension = fileName.split('.').pop()?.toLowerCase();

    if (!allowedExtensions.includes(extension)) {
      return 'Only PDF, DOCX, JPG, JPEG, PNG and WEBP files are allowed.';
    }

    return '';
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const validationError = validateForm();

    if (validationError) {
      setMessage({
        type: 'error',
        text: validationError,
      });
      return;
    }

    setUploading(true);
    setMessage(null);

    try {
      await uploadPolicy(form);

      setMessage({
        type: 'success',
        text: 'Policy uploaded successfully.',
      });

      resetForm();
      await loadPolicies();
    } catch (error) {
      setMessage({
        type: 'error',
        text: error?.message || 'Unable to upload policy.',
      });
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(policy) {
    const policyId = policy.id || policy._id;

    if (!policyId) {
      setMessage({
        type: 'error',
        text: 'Invalid policy selected.',
      });
      return;
    }

    setDownloadingId(policyId);
    setMessage(null);

    try {
      await downloadPolicy(
        policyId,
        policy.file_original_name || `${policy.document_id || 'policy'}`
      );
    } catch (error) {
      setMessage({
        type: 'error',
        text: error?.message || 'Unable to download policy.',
      });
    } finally {
      setDownloadingId('');
    }
  }

  return (
    <div className="policies-page">
      <style>{`
        .policies-page {
          display: grid;
          gap: 22px;
        }

        .policy-hero {
          position: relative;
          overflow: hidden;
          border-radius: 28px;
          border: 1px solid rgba(226, 232, 240, 0.95);
          background:
            radial-gradient(circle at top left, rgba(79, 70, 229, 0.14), transparent 32%),
            radial-gradient(circle at bottom right, rgba(5, 150, 105, 0.13), transparent 36%),
            #ffffff;
          box-shadow: 0 20px 60px rgba(15, 23, 42, 0.08);
          padding: 28px;
        }

        .policy-hero-inner {
          position: relative;
          z-index: 2;
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 22px;
          align-items: center;
        }

        .policy-kicker {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          width: fit-content;
          padding: 8px 12px;
          border-radius: 999px;
          background: #eef2ff;
          color: #4f46e5;
          font-size: 13px;
          font-weight: 800;
          margin-bottom: 12px;
        }

        .policy-hero h1 {
          margin: 0;
          font-size: clamp(26px, 4vw, 38px);
          line-height: 1.08;
          color: #0f172a;
          letter-spacing: -0.04em;
        }

        .policy-hero p {
          margin: 12px 0 0;
          max-width: 760px;
          color: #64748b;
          font-size: 15px;
          line-height: 1.7;
        }

        .policy-hero-stat {
          min-width: 190px;
          padding: 18px;
          border-radius: 22px;
          background: rgba(255, 255, 255, 0.78);
          border: 1px solid rgba(226, 232, 240, 0.9);
          box-shadow: 0 14px 35px rgba(15, 23, 42, 0.07);
        }

        .policy-hero-stat span {
          display: block;
          color: #64748b;
          font-size: 13px;
          font-weight: 700;
        }

        .policy-hero-stat strong {
          display: block;
          margin-top: 8px;
          color: #0f172a;
          font-size: 32px;
          line-height: 1;
        }

        .policy-card {
          border-radius: 24px;
          border: 1px solid #e2e8f0;
          background: #ffffff;
          box-shadow: 0 16px 45px rgba(15, 23, 42, 0.06);
          overflow: hidden;
        }

        .policy-card-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 14px;
          padding: 22px 24px;
          border-bottom: 1px solid #e2e8f0;
          background: linear-gradient(180deg, #ffffff, #f8fafc);
        }

        .policy-card-title {
          display: flex;
          align-items: center;
          gap: 12px;
          margin: 0;
          color: #0f172a;
          font-size: 18px;
          font-weight: 900;
        }

        .policy-card-subtitle {
          margin: 6px 0 0;
          color: #64748b;
          font-size: 13px;
          line-height: 1.5;
        }

        .policy-icon-box {
          width: 42px;
          height: 42px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 15px;
          background: #eef2ff;
          color: #4f46e5;
          flex: 0 0 auto;
        }

        .policy-form {
          padding: 24px;
          display: grid;
          grid-template-columns: 0.75fr 1fr;
          gap: 18px;
        }

        .policy-field {
          display: grid;
          gap: 8px;
        }

        .policy-field.full {
          grid-column: 1 / -1;
        }

        .policy-field label {
          color: #334155;
          font-size: 13px;
          font-weight: 800;
        }

        .policy-field input,
        .policy-field textarea {
          width: 100%;
          border: 1px solid #dbe3ef;
          border-radius: 16px;
          background: #ffffff;
          padding: 13px 14px;
          color: #0f172a;
          outline: none;
          font-size: 14px;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }

        .policy-field textarea {
          min-height: 110px;
          resize: vertical;
          line-height: 1.6;
        }

        .policy-field input:focus,
        .policy-field textarea:focus {
          border-color: #4f46e5;
          box-shadow: 0 0 0 4px rgba(79, 70, 229, 0.12);
        }

        .policy-file-input {
          border: 1px dashed #cbd5e1;
          border-radius: 18px;
          padding: 16px;
          background: #f8fafc;
        }

        .policy-file-input input {
          padding: 0;
          border: none;
          box-shadow: none;
          background: transparent;
        }

        .policy-help {
          color: #64748b;
          font-size: 12px;
          line-height: 1.5;
        }

        .policy-actions {
          grid-column: 1 / -1;
          display: flex;
          gap: 12px;
          justify-content: flex-end;
          flex-wrap: wrap;
        }

        .policy-btn {
          border: none;
          border-radius: 15px;
          padding: 12px 16px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          font-weight: 850;
          cursor: pointer;
          transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
          text-decoration: none;
          white-space: nowrap;
        }

        .policy-btn:hover {
          transform: translateY(-1px);
        }

        .policy-btn.primary {
          color: #ffffff;
          background: linear-gradient(135deg, #4f46e5, #3730a3);
          box-shadow: 0 14px 30px rgba(79, 70, 229, 0.24);
        }

        .policy-btn.secondary {
          color: #334155;
          background: #f1f5f9;
          border: 1px solid #e2e8f0;
        }

        .policy-btn.success {
          color: #ffffff;
          background: linear-gradient(135deg, #059669, #047857);
          box-shadow: 0 14px 30px rgba(5, 150, 105, 0.22);
        }

        .policy-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
          box-shadow: none;
        }

        .policy-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding: 18px 24px;
          border-bottom: 1px solid #e2e8f0;
          background: #ffffff;
        }

        .policy-search {
          flex: 1;
          max-width: 460px;
          display: flex;
          align-items: center;
          gap: 10px;
          border: 1px solid #dbe3ef;
          border-radius: 16px;
          padding: 0 13px;
          background: #f8fafc;
        }

        .policy-search svg {
          color: #64748b;
          flex: 0 0 auto;
        }

        .policy-search input {
          width: 100%;
          border: none;
          outline: none;
          background: transparent;
          padding: 12px 0;
          color: #0f172a;
          font-size: 14px;
        }

        .policy-count {
          padding: 8px 12px;
          border-radius: 999px;
          background: #ecfdf5;
          color: #047857;
          font-size: 13px;
          font-weight: 900;
          white-space: nowrap;
        }

        .policy-alert {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          border-radius: 18px;
          padding: 14px 16px;
          border: 1px solid;
          font-size: 14px;
          line-height: 1.5;
        }

        .policy-alert.success {
          background: #ecfdf5;
          border-color: #bbf7d0;
          color: #047857;
        }

        .policy-alert.error {
          background: #fff1f2;
          border-color: #fecdd3;
          color: #be123c;
        }

        .policy-alert-main {
          display: flex;
          align-items: flex-start;
          gap: 10px;
        }

        .policy-alert button {
          border: none;
          background: transparent;
          cursor: pointer;
          color: inherit;
          padding: 0;
        }

        .policy-table-wrap {
          width: 100%;
          overflow-x: auto;
        }

        .policy-table {
          width: 100%;
          border-collapse: collapse;
          min-width: 920px;
        }

        .policy-table th {
          background: #f8fafc;
          color: #475569;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          text-align: left;
          padding: 14px 16px;
          border-bottom: 1px solid #e2e8f0;
        }

        .policy-table td {
          padding: 16px;
          border-bottom: 1px solid #edf2f7;
          color: #334155;
          vertical-align: top;
          font-size: 14px;
        }

        .policy-doc-id {
          font-weight: 900;
          color: #4f46e5;
          white-space: nowrap;
        }

        .policy-title {
          font-weight: 900;
          color: #0f172a;
          margin-bottom: 5px;
        }

        .policy-summary {
          color: #64748b;
          line-height: 1.5;
          max-width: 430px;
        }

        .policy-file-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          border-radius: 13px;
          background: #f1f5f9;
          color: #334155;
          font-weight: 850;
          font-size: 12px;
        }

        .policy-status {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 7px 10px;
          border-radius: 999px;
          background: #ecfdf5;
          color: #047857;
          font-size: 12px;
          font-weight: 900;
          text-transform: capitalize;
        }

        .policy-empty {
          padding: 42px 24px;
          display: grid;
          place-items: center;
          text-align: center;
          color: #64748b;
        }

        .policy-empty svg {
          color: #94a3b8;
          margin-bottom: 12px;
        }

        .policy-empty strong {
          display: block;
          color: #0f172a;
          font-size: 17px;
          margin-bottom: 6px;
        }

        @media (max-width: 900px) {
          .policy-hero-inner {
            grid-template-columns: 1fr;
          }

          .policy-hero-stat {
            min-width: 0;
          }

          .policy-form {
            grid-template-columns: 1fr;
          }

          .policy-toolbar {
            align-items: stretch;
            flex-direction: column;
          }

          .policy-search {
            max-width: none;
          }
        }

        @media (max-width: 640px) {
          .policy-hero,
          .policy-form,
          .policy-card-head,
          .policy-toolbar {
            padding: 18px;
          }

          .policy-actions {
            justify-content: stretch;
          }

          .policy-btn {
            width: 100%;
          }
        }
      `}</style>

      <section className="policy-hero">
        <div className="policy-hero-inner">
          <div>
            <div className="policy-kicker">
              <ShieldCheck size={16} />
              Tenant-wise Policy Centre
            </div>

            <h1>Policies & Documents</h1>

            <p>
              View official HR policy documents uploaded for your company. HR can upload
              tenant-specific policies, and employees can securely download the documents.
            </p>
          </div>

          <div className="policy-hero-stat">
            <span>Total Policies</span>
            <strong>{policies.length}</strong>
          </div>
        </div>
      </section>

      {message ? (
        <div className={`policy-alert ${message.type}`}>
          <div className="policy-alert-main">
            {message.type === 'success' ? (
              <CheckCircle2 size={20} />
            ) : (
              <AlertCircle size={20} />
            )}
            <span>{message.text}</span>
          </div>

          <button type="button" onClick={() => setMessage(null)} aria-label="Close message">
            <X size={18} />
          </button>
        </div>
      ) : null}

      {allowUpload ? (
        <section className="policy-card">
          <div className="policy-card-head">
            <div>
              <h2 className="policy-card-title">
                <span className="policy-icon-box">
                  <Upload size={20} />
                </span>
                Upload New Policy
              </h2>
              <p className="policy-card-subtitle">
                This policy will be visible only to employees of your tenant.
              </p>
            </div>
          </div>

          <form className="policy-form" onSubmit={handleSubmit}>
            <div className="policy-field">
              <label htmlFor="document_id">Document ID Number</label>
              <input
                id="document_id"
                type="text"
                value={form.document_id}
                onChange={(event) => updateForm('document_id', event.target.value)}
                placeholder="Example: HR-POL-001"
              />
            </div>

            <div className="policy-field">
              <label htmlFor="title">Title of the Policy</label>
              <input
                id="title"
                type="text"
                value={form.title}
                onChange={(event) => updateForm('title', event.target.value)}
                placeholder="Example: Leave Policy"
              />
            </div>

            <div className="policy-field full">
              <label htmlFor="summary">Summary of the Policy</label>
              <textarea
                id="summary"
                value={form.summary}
                onChange={(event) => updateForm('summary', event.target.value)}
                placeholder="Write a short summary of this policy."
              />
            </div>

            <div className="policy-field full">
              <label htmlFor="policy-file-input">Policy Document</label>

              <div className="policy-file-input">
                <input
                  id="policy-file-input"
                  type="file"
                  accept={ACCEPTED_FILE_TYPES}
                  onChange={(event) => {
                    updateForm('file', event.target.files?.[0] || null);
                  }}
                />

                <div className="policy-help">
                  Allowed files: PDF, DOCX, JPG, JPEG, PNG, WEBP.
                </div>
              </div>
            </div>

            <div className="policy-actions">
              <button
                className="policy-btn secondary"
                type="button"
                onClick={resetForm}
                disabled={uploading}
              >
                Clear
              </button>

              <button
                className="policy-btn primary"
                type="submit"
                disabled={uploading}
              >
                {uploading ? (
                  <>
                    <RefreshCw size={17} />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload size={17} />
                    Upload Policy
                  </>
                )}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="policy-card">
        <div className="policy-card-head">
          <div>
            <h2 className="policy-card-title">
              <span className="policy-icon-box">
                <FileText size={20} />
              </span>
              Policy List
            </h2>
            <p className="policy-card-subtitle">
              Employees can download policies uploaded for their tenant.
            </p>
          </div>
        </div>

        <div className="policy-toolbar">
          <div className="policy-search">
            <Search size={18} />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by document ID, title, summary..."
            />
          </div>

          <div className="policy-actions">
            <span className="policy-count">
              {filteredPolicies.length} Found
            </span>

            <button
              className="policy-btn secondary"
              type="button"
              onClick={loadPolicies}
              disabled={loading}
            >
              <RefreshCw size={17} />
              Refresh
            </button>
          </div>
        </div>

        {loading ? (
          <div className="policy-empty">
            <RefreshCw size={32} />
            <strong>Loading policies...</strong>
            <span>Please wait while policies are being fetched.</span>
          </div>
        ) : filteredPolicies.length ? (
          <div className="policy-table-wrap">
            <table className="policy-table">
              <thead>
                <tr>
                  <th>Document ID</th>
                  <th>Policy Details</th>
                  <th>File</th>
                  <th>Uploaded By</th>
                  <th>Uploaded Date</th>
                  <th>Status</th>
                  <th>Download</th>
                </tr>
              </thead>

              <tbody>
                {filteredPolicies.map((policy) => {
                  const policyId = policy.id || policy._id;

                  return (
                    <tr key={policyId}>
                      <td>
                        <span className="policy-doc-id">
                          {policy.document_id || '—'}
                        </span>
                      </td>

                      <td>
                        <div className="policy-title">
                          {policy.title || 'Untitled Policy'}
                        </div>
                        <div className="policy-summary">
                          {policy.summary || 'No summary added.'}
                        </div>
                      </td>

                      <td>
                        <span className="policy-file-badge">
                          <FileText size={15} />
                          {getFileBadge(policy)}
                          {' · '}
                          {formatFileSize(policy.file_size_bytes)}
                        </span>
                      </td>

                      <td>{policy.created_by_name || '—'}</td>

                      <td>{formatDate(policy.created_at)}</td>

                      <td>
                        <span className="policy-status">
                          <CheckCircle2 size={13} />
                          {policy.status || 'active'}
                        </span>
                      </td>

                      <td>
                        <button
                          className="policy-btn success"
                          type="button"
                          onClick={() => handleDownload(policy)}
                          disabled={downloadingId === policyId}
                        >
                          {downloadingId === policyId ? (
                            <>
                              <RefreshCw size={16} />
                              Downloading...
                            </>
                          ) : (
                            <>
                              <Download size={16} />
                              Download
                            </>
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="policy-empty">
            <FileText size={34} />
            <strong>No policies found</strong>
            <span>
              {search
                ? 'No policy matches your search.'
                : 'No policy has been uploaded for your tenant yet.'}
            </span>
          </div>
        )}
      </section>
    </div>
  );
}