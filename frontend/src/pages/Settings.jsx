import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  ImagePlus,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UploadCloud,
} from 'lucide-react';

import { api, normalizeProfilePhotoUrl } from '../api/client';
import ModuleCrud from './ModuleCrud';

const MAX_LOGO_BYTES = 3 * 1024 * 1024;
const ALLOWED_LOGO_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

function safeText(value, fallback = '') {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

function getBrandingFromResponse(data = {}) {
  const branding = data.branding || {};
  const tenant = data.tenant || {};
  const nestedBranding = tenant.branding || {};

  return {
    tenantId: safeText(
      branding.tenant_id ||
        tenant.tenant_id ||
        tenant.id ||
        tenant._id,
    ),
    companyName: safeText(
      branding.company_name ||
        branding.name ||
        tenant.company_name ||
        tenant.name ||
        tenant.tenant_name ||
        nestedBranding.company_name,
      'Your Company',
    ),
    logo: safeText(
      branding.company_logo ||
        branding.company_logo_url ||
        branding.logo ||
        branding.logo_url ||
        tenant.company_logo ||
        tenant.company_logo_url ||
        tenant.logo ||
        tenant.logo_url ||
        nestedBranding.company_logo ||
        nestedBranding.company_logo_url ||
        nestedBranding.logo ||
        nestedBranding.logo_url,
    ),
  };
}

function formatFileSize(bytes = 0) {
  if (!Number.isFinite(Number(bytes)) || Number(bytes) <= 0) {
    return '';
  }

  const size = Number(bytes);

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

export default function Settings() {
  const fileInputRef = useRef(null);
  const previewUrlRef = useRef('');

  const [branding, setBranding] = useState({
    tenantId: '',
    companyName: 'Your Company',
    logo: '',
  });
  const [selectedFile, setSelectedFile] = useState(null);
  const [localPreview, setLocalPreview] = useState('');
  const [canManageBranding, setCanManageBranding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const savedLogoUrl = useMemo(
    () => normalizeProfilePhotoUrl(branding.logo),
    [branding.logo],
  );

  const previewLogoUrl = localPreview || savedLogoUrl;
  const busy = loading || saving || removing;

  function clearLocalPreview() {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = '';
    }

    setLocalPreview('');
  }

  function resetSelectedFile() {
    clearLocalPreview();
    setSelectedFile(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  async function loadBranding({ silent = false } = {}) {
    if (!silent) {
      setLoading(true);
    }

    setError('');

    try {
      const data = await api('/tenant-branding');

      setBranding(getBrandingFromResponse(data));
      setCanManageBranding(Boolean(data.can_manage_branding));
    } catch (requestError) {
      setError(
        requestError?.message ||
          'Unable to load company branding. Please refresh and try again.',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBranding();

    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, []);

  function handleFileChange(event) {
    const file = event.target.files?.[0];

    setMessage('');
    setError('');

    if (!file) {
      resetSelectedFile();
      return;
    }

    if (!ALLOWED_LOGO_TYPES.has(String(file.type || '').toLowerCase())) {
      resetSelectedFile();
      setError('Please select a JPG, JPEG, PNG, or WEBP image.');
      return;
    }

    if (file.size > MAX_LOGO_BYTES) {
      resetSelectedFile();
      setError('Company logo must be 3 MB or smaller.');
      return;
    }

    clearLocalPreview();

    const objectUrl = URL.createObjectURL(file);
    previewUrlRef.current = objectUrl;

    setSelectedFile(file);
    setLocalPreview(objectUrl);
  }

  async function uploadLogo(event) {
    event.preventDefault();

    if (!selectedFile) {
      setError('Select a company logo before uploading.');
      return;
    }

    setSaving(true);
    setMessage('');
    setError('');

    try {
      const formData = new FormData();
      formData.append('logo', selectedFile);

      const data = await api('/tenant-branding/logo', {
        method: 'POST',
        body: formData,
        timeoutMs: 60000,
      });

      setBranding(getBrandingFromResponse(data));
      resetSelectedFile();
      setMessage(data.message || 'Company logo uploaded successfully.');
    } catch (requestError) {
      setError(
        requestError?.message ||
          'Unable to upload the company logo. Please try again.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeLogo() {
    if (!branding.logo) {
      return;
    }

    const confirmed = window.confirm(
      'Remove the company logo from this tenant? The dashboards will fall back to the company initials.',
    );

    if (!confirmed) {
      return;
    }

    setRemoving(true);
    setMessage('');
    setError('');

    try {
      const data = await api('/tenant-branding/logo', {
        method: 'DELETE',
      });

      setBranding(getBrandingFromResponse(data));
      resetSelectedFile();
      setMessage(data.message || 'Company logo removed successfully.');
    } catch (requestError) {
      setError(
        requestError?.message ||
          'Unable to remove the company logo. Please try again.',
      );
    } finally {
      setRemoving(false);
    }
  }

  const initials = branding.companyName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase() || 'YC';

  return (
    <div className="settings-branding-page">
      <style>{`
        .settings-branding-page {
          display: grid;
          gap: 22px;
        }

        .tenant-branding-panel {
          position: relative;
          overflow: hidden;
          border: 1px solid rgba(148, 163, 184, .28);
          border-radius: 28px;
          background:
            radial-gradient(circle at 9% 5%, rgba(99, 102, 241, .18), transparent 32%),
            radial-gradient(circle at 92% 10%, rgba(14, 165, 233, .14), transparent 30%),
            linear-gradient(145deg, #ffffff 0%, #f8fafc 100%);
          box-shadow: 0 22px 55px rgba(15, 23, 42, .09);
          padding: clamp(20px, 3vw, 32px);
        }

        .tenant-branding-panel::after {
          content: '';
          position: absolute;
          width: 220px;
          height: 220px;
          right: -105px;
          bottom: -125px;
          border-radius: 50%;
          background: rgba(99, 102, 241, .09);
          pointer-events: none;
        }

        .tenant-branding-heading {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 18px;
          margin-bottom: 24px;
        }

        .tenant-branding-kicker {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 9px;
          color: #4f46e5;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: .11em;
          text-transform: uppercase;
        }

        .tenant-branding-heading h1 {
          margin: 0;
          color: #0f172a;
          font-size: clamp(25px, 3vw, 34px);
          line-height: 1.1;
        }

        .tenant-branding-heading p {
          max-width: 720px;
          margin: 10px 0 0;
          color: #64748b;
          line-height: 1.65;
        }

        .tenant-branding-refresh {
          width: 42px;
          height: 42px;
          flex: 0 0 42px;
          display: grid;
          place-items: center;
          border: 1px solid #e2e8f0;
          border-radius: 14px;
          background: rgba(255, 255, 255, .86);
          color: #475569;
          cursor: pointer;
          box-shadow: 0 10px 24px rgba(15, 23, 42, .07);
        }

        .tenant-branding-refresh:hover:not(:disabled) {
          color: #4f46e5;
          border-color: #c7d2fe;
        }

        .tenant-branding-refresh:disabled {
          cursor: not-allowed;
          opacity: .55;
        }

        .tenant-branding-layout {
          position: relative;
          z-index: 1;
          display: grid;
          grid-template-columns: minmax(250px, .86fr) minmax(330px, 1.14fr);
          gap: 22px;
          align-items: stretch;
        }

        .tenant-brand-preview,
        .tenant-brand-editor {
          border: 1px solid rgba(203, 213, 225, .74);
          border-radius: 24px;
          background: rgba(255, 255, 255, .86);
          backdrop-filter: blur(12px);
        }

        .tenant-brand-preview {
          min-height: 300px;
          display: grid;
          place-items: center;
          padding: 28px;
          text-align: center;
        }

        .tenant-brand-preview-inner {
          width: 100%;
          display: grid;
          justify-items: center;
          gap: 16px;
        }

        .tenant-logo-preview {
          width: 128px;
          height: 128px;
          display: grid;
          place-items: center;
          overflow: hidden;
          border: 5px solid #ffffff;
          border-radius: 32px;
          background: linear-gradient(145deg, #eef2ff, #ecfeff);
          box-shadow: 0 20px 44px rgba(79, 70, 229, .18);
          color: #4338ca;
          font-size: 36px;
          font-weight: 950;
          letter-spacing: -.04em;
        }

        .tenant-logo-preview img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          display: block;
          background: #ffffff;
        }

        .tenant-company-script {
          margin: 0;
          color: #172554;
          font-family: 'Brush Script MT', 'Segoe Script', 'Lucida Handwriting', cursive;
          font-size: clamp(31px, 4vw, 45px);
          font-weight: 600;
          line-height: 1.15;
          letter-spacing: .01em;
        }

        .tenant-brand-preview small {
          color: #64748b;
          font-weight: 700;
        }

        .tenant-brand-editor {
          display: grid;
          align-content: center;
          gap: 18px;
          padding: 26px;
        }

        .tenant-brand-editor h2 {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 0;
          color: #0f172a;
          font-size: 20px;
        }

        .tenant-brand-editor > p {
          margin: -8px 0 0;
          color: #64748b;
          line-height: 1.6;
        }

        .tenant-logo-dropzone {
          display: grid;
          grid-template-columns: 48px minmax(0, 1fr);
          gap: 14px;
          align-items: center;
          border: 1.5px dashed #a5b4fc;
          border-radius: 20px;
          background: #f8faff;
          padding: 16px;
          cursor: pointer;
          transition: border-color .18s ease, transform .18s ease, background .18s ease;
        }

        .tenant-logo-dropzone:hover {
          border-color: #6366f1;
          background: #f4f5ff;
          transform: translateY(-1px);
        }

        .tenant-logo-dropzone.is-disabled {
          cursor: not-allowed;
          opacity: .62;
          transform: none;
        }

        .tenant-logo-dropzone input {
          display: none;
        }

        .tenant-logo-dropzone-icon {
          width: 48px;
          height: 48px;
          display: grid;
          place-items: center;
          border-radius: 16px;
          background: #e0e7ff;
          color: #4f46e5;
        }

        .tenant-logo-dropzone strong,
        .tenant-logo-dropzone span {
          display: block;
        }

        .tenant-logo-dropzone strong {
          color: #1e293b;
          line-height: 1.4;
        }

        .tenant-logo-dropzone span {
          margin-top: 4px;
          color: #64748b;
          font-size: 13px;
          line-height: 1.45;
        }

        .tenant-logo-file-meta {
          display: flex;
          align-items: center;
          gap: 9px;
          min-width: 0;
          border-radius: 14px;
          background: #f1f5f9;
          padding: 10px 12px;
          color: #475569;
          font-size: 13px;
          font-weight: 700;
        }

        .tenant-logo-file-meta span {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .tenant-brand-actions {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }

        .tenant-brand-actions button {
          width: auto;
          min-height: 43px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          border-radius: 14px;
          padding: 10px 16px;
          font-weight: 850;
          cursor: pointer;
        }

        .tenant-logo-save {
          border: 1px solid #4f46e5;
          background: linear-gradient(135deg, #4f46e5, #6366f1);
          color: #ffffff;
          box-shadow: 0 12px 24px rgba(79, 70, 229, .22);
        }

        .tenant-logo-remove {
          border: 1px solid #fecaca;
          background: #fff1f2;
          color: #be123c;
        }

        .tenant-brand-actions button:disabled {
          cursor: not-allowed;
          opacity: .55;
          box-shadow: none;
        }

        .tenant-brand-message {
          display: flex;
          align-items: flex-start;
          gap: 9px;
          border-radius: 14px;
          padding: 12px 14px;
          font-size: 14px;
          font-weight: 700;
          line-height: 1.5;
        }

        .tenant-brand-message.success {
          border: 1px solid #bbf7d0;
          background: #f0fdf4;
          color: #166534;
        }

        .tenant-brand-message.error {
          border: 1px solid #fecaca;
          background: #fff1f2;
          color: #b91c1c;
        }

        .tenant-brand-permission {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          border: 1px solid #dbeafe;
          border-radius: 16px;
          background: #eff6ff;
          padding: 13px 14px;
          color: #1e40af;
          font-size: 14px;
          font-weight: 700;
          line-height: 1.5;
        }

        .tenant-brand-loading {
          min-height: 240px;
          display: grid;
          place-items: center;
          color: #64748b;
          font-weight: 800;
        }

        .tenant-brand-loading span {
          display: inline-flex;
          align-items: center;
          gap: 9px;
        }

        .tenant-brand-spin {
          animation: tenantBrandSpin .8s linear infinite;
        }

        @keyframes tenantBrandSpin {
          to { transform: rotate(360deg); }
        }

        @media (max-width: 880px) {
          .tenant-branding-layout {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 560px) {
          .tenant-branding-panel {
            border-radius: 22px;
            padding: 18px;
          }

          .tenant-branding-heading {
            align-items: center;
          }

          .tenant-brand-preview,
          .tenant-brand-editor {
            border-radius: 20px;
          }

          .tenant-brand-preview {
            min-height: 260px;
            padding: 22px 16px;
          }

          .tenant-brand-editor {
            padding: 20px 16px;
          }

          .tenant-logo-preview {
            width: 110px;
            height: 110px;
            border-radius: 28px;
          }

          .tenant-brand-actions button {
            flex: 1 1 100%;
          }
        }
      `}</style>

      <section className="tenant-branding-panel">
        <div className="tenant-branding-heading">
          <div>
            <span className="tenant-branding-kicker">
              <Building2 size={15} /> Tenant Branding
            </span>
            <h1>Company Identity</h1>
            <p>
              Upload the logo for this tenant. It will be used with the company name
              on the tenant administrator and employee dashboards.
            </p>
          </div>

          <button
            type="button"
            className="tenant-branding-refresh"
            onClick={() => loadBranding()}
            disabled={busy}
            title="Refresh company branding"
            aria-label="Refresh company branding"
          >
            <RefreshCw size={18} className={loading ? 'tenant-brand-spin' : ''} />
          </button>
        </div>

        {loading ? (
          <div className="tenant-brand-loading">
            <span>
              <LoaderCircle size={21} className="tenant-brand-spin" />
              Loading company branding...
            </span>
          </div>
        ) : (
          <div className="tenant-branding-layout">
            <div className="tenant-brand-preview">
              <div className="tenant-brand-preview-inner">
                <div className="tenant-logo-preview">
                  {previewLogoUrl ? (
                    <img
                      src={previewLogoUrl}
                      alt={`${branding.companyName} logo`}
                      onError={(event) => {
                        event.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : (
                    initials
                  )}
                </div>

                <h2 className="tenant-company-script">{branding.companyName}</h2>
                <small>Dashboard branding preview</small>
              </div>
            </div>

            <form className="tenant-brand-editor" onSubmit={uploadLogo}>
              <h2>
                <ImagePlus size={21} /> Company Logo
              </h2>
              <p>
                Use a clear square or horizontal logo with a transparent or white
                background for the best dashboard appearance.
              </p>

              {canManageBranding ? (
                <>
                  <label
                    className={`tenant-logo-dropzone${busy ? ' is-disabled' : ''}`}
                  >
                    <span className="tenant-logo-dropzone-icon">
                      <UploadCloud size={23} />
                    </span>
                    <span>
                      <strong>
                        {selectedFile ? 'Choose a different logo' : 'Select company logo'}
                      </strong>
                      <span>JPG, JPEG, PNG, or WEBP · Maximum 3 MB</span>
                    </span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                      onChange={handleFileChange}
                      disabled={busy}
                    />
                  </label>

                  {selectedFile && (
                    <div className="tenant-logo-file-meta">
                      <CheckCircle2 size={17} />
                      <span>
                        {selectedFile.name} · {formatFileSize(selectedFile.size)}
                      </span>
                    </div>
                  )}

                  <div className="tenant-brand-actions">
                    <button
                      type="submit"
                      className="tenant-logo-save"
                      disabled={!selectedFile || busy}
                    >
                      {saving ? (
                        <LoaderCircle size={17} className="tenant-brand-spin" />
                      ) : (
                        <UploadCloud size={17} />
                      )}
                      {saving ? 'Uploading Logo...' : 'Upload Logo'}
                    </button>

                    <button
                      type="button"
                      className="tenant-logo-remove"
                      onClick={removeLogo}
                      disabled={!branding.logo || busy}
                    >
                      {removing ? (
                        <LoaderCircle size={17} className="tenant-brand-spin" />
                      ) : (
                        <Trash2 size={17} />
                      )}
                      {removing ? 'Removing...' : 'Remove Current Logo'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="tenant-brand-permission">
                  <ShieldCheck size={19} />
                  Only the administrator of this tenant can upload or remove the
                  company logo.
                </div>
              )}

              {message && (
                <div className="tenant-brand-message success">
                  <CheckCircle2 size={18} />
                  <span>{message}</span>
                </div>
              )}

              {error && (
                <div className="tenant-brand-message error">
                  <span>{error}</span>
                </div>
              )}
            </form>
          </div>
        )}
      </section>

      <ModuleCrud collection="system_settings" />
    </div>
  );
}