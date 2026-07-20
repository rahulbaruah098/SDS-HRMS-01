import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  Globe2,
  CheckCircle2,
  ImagePlus,
  LoaderCircle,
  RefreshCw,
  Save,
  ShieldCheck,
  Type,
  Trash2,
  UploadCloud,
} from 'lucide-react';

import { api, normalizeProfilePhotoUrl } from '../api/client';
import { normalizeRoleList } from '../data/modules';

const MAX_LOGO_BYTES = 3 * 1024 * 1024;
const MAX_PLATFORM_LOGO_BYTES = 3 * 1024 * 1024;
const DEFAULT_PLATFORM_TAGLINE = 'People, Process and Performance';
const MAX_PLATFORM_TAGLINE_LENGTH = 160;
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

function getPlatformBrandingFromResponse(data = {}) {
  const branding = data.branding || data.platform_branding || {};

  return {
    productName: safeText(
      branding.product_name || branding.name,
      'YourComate',
    ),
    tagline: safeText(
      branding.tagline || branding.platform_tagline,
      DEFAULT_PLATFORM_TAGLINE,
    ),
    logo: safeText(
      branding.platform_logo ||
        branding.platform_logo_url ||
        branding.logo ||
        branding.logo_url,
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

export default function Settings({ user }) {
  const fileInputRef = useRef(null);
  const previewUrlRef = useRef('');
  const platformFileInputRef = useRef(null);
  const platformPreviewUrlRef = useRef('');

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

  const [platformBranding, setPlatformBranding] = useState({
    productName: 'YourComate',
    tagline: DEFAULT_PLATFORM_TAGLINE,
    logo: '',
  });
  const [platformTagline, setPlatformTagline] = useState(
    DEFAULT_PLATFORM_TAGLINE,
  );
  const [selectedPlatformFile, setSelectedPlatformFile] = useState(null);
  const [localPlatformPreview, setLocalPlatformPreview] = useState('');
  const [canManagePlatformBranding, setCanManagePlatformBranding] = useState(false);
  const [platformLoading, setPlatformLoading] = useState(true);
  const [platformSaving, setPlatformSaving] = useState(false);
  const [platformRemoving, setPlatformRemoving] = useState(false);
  const [platformMessage, setPlatformMessage] = useState('');
  const [platformError, setPlatformError] = useState('');

  const userRoles = useMemo(() => {
    const normalizedRoles = [
      ...normalizeRoleList(user?.roles),
      ...normalizeRoleList(user?.role),
      ...normalizeRoleList(user?.primary_role),
      ...normalizeRoleList(user?.dashboard_role),
    ];

    return [...new Set(normalizedRoles)];
  }, [user]);

  const isPlatformSuperadmin =
    Boolean(user?.is_platform_superadmin) || userRoles.includes('super_admin');

  const savedLogoUrl = useMemo(
    () => normalizeProfilePhotoUrl(branding.logo),
    [branding.logo],
  );

  const previewLogoUrl = localPreview || savedLogoUrl;
  const busy = loading || saving || removing;

  const savedPlatformLogoUrl = useMemo(
    () => normalizeProfilePhotoUrl(platformBranding.logo),
    [platformBranding.logo],
  );
  const previewPlatformLogoUrl = localPlatformPreview || savedPlatformLogoUrl;
  const platformBusy = platformLoading || platformSaving || platformRemoving;

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

  function clearPlatformLocalPreview() {
    if (platformPreviewUrlRef.current) {
      URL.revokeObjectURL(platformPreviewUrlRef.current);
      platformPreviewUrlRef.current = '';
    }

    setLocalPlatformPreview('');
  }

  function resetSelectedPlatformFile() {
    clearPlatformLocalPreview();
    setSelectedPlatformFile(null);

    if (platformFileInputRef.current) {
      platformFileInputRef.current.value = '';
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

  async function loadPlatformBranding({ silent = false } = {}) {
    if (!silent) {
      setPlatformLoading(true);
    }

    setPlatformError('');

    try {
      const data = await api('/platform-branding');
      const nextBranding = getPlatformBrandingFromResponse(data);

      setPlatformBranding(nextBranding);
      setPlatformTagline(nextBranding.tagline);
      setCanManagePlatformBranding(Boolean(data.can_manage_branding));
    } catch (requestError) {
      setPlatformError(
        requestError?.message ||
          'Unable to load YourComate branding. Please refresh and try again.',
      );
    } finally {
      setPlatformLoading(false);
    }
  }

  useEffect(() => {
    loadBranding();

    if (isPlatformSuperadmin) {
      loadPlatformBranding();
    } else {
      setPlatformLoading(false);
      setPlatformMessage('');
      setPlatformError('');
    }

    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }

      if (platformPreviewUrlRef.current) {
        URL.revokeObjectURL(platformPreviewUrlRef.current);
      }
    };
  }, [isPlatformSuperadmin]);

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

  function handlePlatformFileChange(event) {
    const file = event.target.files?.[0];

    setPlatformMessage('');
    setPlatformError('');

    if (!file) {
      resetSelectedPlatformFile();
      return;
    }

    if (!ALLOWED_LOGO_TYPES.has(String(file.type || '').toLowerCase())) {
      resetSelectedPlatformFile();
      setPlatformError('Please select a JPG, JPEG, PNG, or WEBP image.');
      return;
    }

    if (file.size > MAX_PLATFORM_LOGO_BYTES) {
      resetSelectedPlatformFile();
      setPlatformError('YourComate logo must be 3 MB or smaller.');
      return;
    }

    clearPlatformLocalPreview();

    const objectUrl = URL.createObjectURL(file);
    platformPreviewUrlRef.current = objectUrl;

    setSelectedPlatformFile(file);
    setLocalPlatformPreview(objectUrl);
  }

  async function savePlatformBranding(event) {
    event.preventDefault();

    const normalizedTagline = safeText(platformTagline);

    if (!normalizedTagline) {
      setPlatformError('Enter the YourComate tagline before saving.');
      return;
    }

    if (normalizedTagline.length > MAX_PLATFORM_TAGLINE_LENGTH) {
      setPlatformError(
        `Tagline must be ${MAX_PLATFORM_TAGLINE_LENGTH} characters or fewer.`,
      );
      return;
    }

    setPlatformSaving(true);
    setPlatformMessage('');
    setPlatformError('');

    try {
      const formData = new FormData();
      formData.append('tagline', normalizedTagline);

      if (selectedPlatformFile) {
        formData.append('logo', selectedPlatformFile);
      }

      const data = await api('/platform-branding', {
        method: 'POST',
        body: formData,
        timeoutMs: 60000,
      });
      const nextBranding = getPlatformBrandingFromResponse(data);

      setPlatformBranding(nextBranding);
      setPlatformTagline(nextBranding.tagline);
      setCanManagePlatformBranding(Boolean(data.can_manage_branding));
      resetSelectedPlatformFile();
      setPlatformMessage(
        data.message || 'YourComate branding updated successfully.',
      );
    } catch (requestError) {
      setPlatformError(
        requestError?.message ||
          'Unable to save YourComate branding. Please try again.',
      );
    } finally {
      setPlatformSaving(false);
    }
  }

  async function removePlatformLogo() {
    if (!platformBranding.logo) {
      return;
    }

    const confirmed = window.confirm(
      'Remove the global YourComate logo? The sidebar will use the YC initials until another logo is uploaded.',
    );

    if (!confirmed) {
      return;
    }

    setPlatformRemoving(true);
    setPlatformMessage('');
    setPlatformError('');

    try {
      const data = await api('/platform-branding/logo', {
        method: 'DELETE',
      });
      const nextBranding = getPlatformBrandingFromResponse(data);

      setPlatformBranding(nextBranding);
      setPlatformTagline(nextBranding.tagline);
      setCanManagePlatformBranding(Boolean(data.can_manage_branding));
      resetSelectedPlatformFile();
      setPlatformMessage(data.message || 'YourComate logo removed successfully.');
    } catch (requestError) {
      setPlatformError(
        requestError?.message ||
          'Unable to remove the YourComate logo. Please try again.',
      );
    } finally {
      setPlatformRemoving(false);
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

        .platform-branding-panel {
          position: relative;
          overflow: hidden;
          border: 1px solid rgba(99, 102, 241, .24);
          border-radius: 28px;
          background:
            radial-gradient(circle at 8% 0%, rgba(79, 70, 229, .18), transparent 34%),
            radial-gradient(circle at 94% 8%, rgba(16, 185, 129, .13), transparent 30%),
            linear-gradient(145deg, #ffffff 0%, #f8fafc 100%);
          box-shadow: 0 22px 55px rgba(15, 23, 42, .09);
          padding: clamp(20px, 3vw, 32px);
        }

        .platform-branding-panel::after {
          content: '';
          position: absolute;
          width: 250px;
          height: 250px;
          right: -120px;
          bottom: -145px;
          border-radius: 50%;
          background: rgba(16, 185, 129, .08);
          pointer-events: none;
        }

        .platform-branding-heading {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 18px;
          margin-bottom: 24px;
        }

        .platform-branding-kicker {
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

        .platform-branding-heading h1 {
          margin: 0;
          color: #0f172a;
          font-size: clamp(25px, 3vw, 34px);
          line-height: 1.1;
        }

        .platform-branding-heading p {
          max-width: 760px;
          margin: 10px 0 0;
          color: #64748b;
          line-height: 1.65;
        }

        .platform-branding-refresh {
          width: 42px;
          height: 42px;
          flex: 0 0 42px;
          display: grid;
          place-items: center;
          border: 1px solid #e2e8f0;
          border-radius: 14px;
          background: rgba(255, 255, 255, .9);
          color: #475569;
          cursor: pointer;
          box-shadow: 0 10px 24px rgba(15, 23, 42, .07);
        }

        .platform-branding-refresh:hover:not(:disabled) {
          color: #4f46e5;
          border-color: #c7d2fe;
        }

        .platform-branding-refresh:disabled {
          cursor: not-allowed;
          opacity: .55;
        }

        .platform-branding-layout {
          position: relative;
          z-index: 1;
          display: grid;
          grid-template-columns: minmax(270px, .9fr) minmax(340px, 1.1fr);
          gap: 22px;
          align-items: stretch;
        }

        .platform-brand-preview,
        .platform-brand-editor {
          border: 1px solid rgba(203, 213, 225, .74);
          border-radius: 24px;
          background: rgba(255, 255, 255, .88);
          backdrop-filter: blur(12px);
        }

        .platform-brand-preview {
          min-height: 300px;
          display: grid;
          place-items: center;
          padding: 28px;
        }

        .platform-sidebar-preview {
          width: min(100%, 390px);
          display: grid;
          grid-template-columns: 78px minmax(0, 1fr);
          gap: 16px;
          align-items: center;
          border: 1px solid #e2e8f0;
          border-radius: 22px;
          background: #ffffff;
          padding: 18px;
          box-shadow: 0 18px 38px rgba(15, 23, 42, .1);
        }

        .platform-logo-preview {
          width: 78px;
          height: 78px;
          display: grid;
          place-items: center;
          overflow: hidden;
          border-radius: 22px;
          background: linear-gradient(145deg, #163f2a, #0f5132);
          color: #ffffff;
          font-size: 25px;
          font-weight: 950;
          letter-spacing: -.04em;
        }

        .platform-logo-preview img {
          width: 100%;
          height: 100%;
          display: block;
          object-fit: contain;
          background: #ffffff;
        }

        .platform-preview-copy {
          min-width: 0;
        }

        .platform-preview-copy h2 {
          margin: 0;
          color: #0f172a;
          font-size: 27px;
          line-height: 1.15;
        }

        .platform-preview-copy p {
          margin: 7px 0 0;
          color: #64748b;
          font-size: 13px;
          font-weight: 750;
          line-height: 1.45;
          overflow-wrap: anywhere;
        }

        .platform-brand-editor {
          display: grid;
          align-content: center;
          gap: 18px;
          padding: 26px;
        }

        .platform-brand-editor h2 {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 0;
          color: #0f172a;
          font-size: 20px;
        }

        .platform-brand-editor > p {
          margin: -8px 0 0;
          color: #64748b;
          line-height: 1.6;
        }

        .platform-tagline-field {
          display: grid;
          gap: 8px;
        }

        .platform-tagline-field label {
          color: #334155;
          font-size: 13px;
          font-weight: 850;
        }

        .platform-tagline-input-wrap {
          position: relative;
        }

        .platform-tagline-input-wrap svg {
          position: absolute;
          left: 14px;
          top: 50%;
          transform: translateY(-50%);
          color: #6366f1;
          pointer-events: none;
        }

        .platform-tagline-input {
          width: 100%;
          min-height: 48px;
          border: 1px solid #cbd5e1;
          border-radius: 15px;
          background: #ffffff;
          padding: 11px 14px 11px 44px;
          color: #0f172a;
          font: inherit;
          font-weight: 700;
          outline: none;
        }

        .platform-tagline-input:focus {
          border-color: #6366f1;
          box-shadow: 0 0 0 4px rgba(99, 102, 241, .12);
        }

        .platform-tagline-input:disabled {
          cursor: not-allowed;
          background: #f8fafc;
          color: #64748b;
        }

        .platform-tagline-meta {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          color: #64748b;
          font-size: 12px;
          font-weight: 700;
        }

        .platform-logo-dropzone {
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

        .platform-logo-dropzone:hover {
          border-color: #6366f1;
          background: #f4f5ff;
          transform: translateY(-1px);
        }

        .platform-logo-dropzone.is-disabled {
          cursor: not-allowed;
          opacity: .62;
          transform: none;
        }

        .platform-logo-dropzone input {
          display: none;
        }

        .platform-logo-dropzone-icon {
          width: 48px;
          height: 48px;
          display: grid;
          place-items: center;
          border-radius: 16px;
          background: #e0e7ff;
          color: #4f46e5;
        }

        .platform-logo-dropzone strong,
        .platform-logo-dropzone span {
          display: block;
        }

        .platform-logo-dropzone strong {
          color: #1e293b;
          line-height: 1.4;
        }

        .platform-logo-dropzone span {
          margin-top: 4px;
          color: #64748b;
          font-size: 13px;
          line-height: 1.45;
        }

        .platform-logo-file-meta {
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

        .platform-logo-file-meta span {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .platform-brand-actions {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }

        .platform-brand-actions button {
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

        .platform-brand-save {
          border: 1px solid #4f46e5;
          background: linear-gradient(135deg, #4f46e5, #6366f1);
          color: #ffffff;
          box-shadow: 0 12px 24px rgba(79, 70, 229, .22);
        }

        .platform-logo-remove {
          border: 1px solid #fecaca;
          background: #fff1f2;
          color: #be123c;
        }

        .platform-brand-actions button:disabled {
          cursor: not-allowed;
          opacity: .55;
          box-shadow: none;
        }

        .platform-brand-message,
        .platform-brand-permission {
          display: flex;
          align-items: flex-start;
          gap: 9px;
          border-radius: 14px;
          padding: 12px 14px;
          font-size: 14px;
          font-weight: 700;
          line-height: 1.5;
        }

        .platform-brand-message.success {
          border: 1px solid #bbf7d0;
          background: #f0fdf4;
          color: #166534;
        }

        .platform-brand-message.error {
          border: 1px solid #fecaca;
          background: #fff1f2;
          color: #b91c1c;
        }

        .platform-brand-permission {
          border: 1px solid #dbeafe;
          background: #eff6ff;
          color: #1e40af;
        }

        .platform-brand-loading {
          min-height: 240px;
          display: grid;
          place-items: center;
          color: #64748b;
          font-weight: 800;
        }

        .platform-brand-loading span {
          display: inline-flex;
          align-items: center;
          gap: 9px;
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
          .platform-branding-layout,
          .tenant-branding-layout {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 560px) {
          .platform-branding-panel,
          .tenant-branding-panel {
            border-radius: 22px;
            padding: 18px;
          }

          .platform-branding-heading,
          .tenant-branding-heading {
            align-items: center;
          }

          .platform-brand-preview,
          .platform-brand-editor {
            border-radius: 20px;
          }

          .platform-brand-preview {
            min-height: 250px;
            padding: 20px 14px;
          }

          .platform-brand-editor {
            padding: 20px 16px;
          }

          .platform-sidebar-preview {
            grid-template-columns: 64px minmax(0, 1fr);
            gap: 13px;
            padding: 15px;
          }

          .platform-logo-preview {
            width: 64px;
            height: 64px;
            border-radius: 18px;
            font-size: 21px;
          }

          .platform-preview-copy h2 {
            font-size: 23px;
          }

          .platform-brand-actions button {
            flex: 1 1 100%;
          }

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

      {isPlatformSuperadmin && (
        <section className="platform-branding-panel">
          <div className="platform-branding-heading">
            <div>
              <span className="platform-branding-kicker">
                <Globe2 size={15} /> Platform Branding
              </span>
              <h1>YourComate Sidebar Identity</h1>
              <p>
                Manage the global YourComate logo and tagline displayed at the top
                of every tenant sidebar. The product name remains fixed as YourComate.
              </p>
            </div>

            <button
              type="button"
              className="platform-branding-refresh"
              onClick={() => loadPlatformBranding()}
              disabled={platformBusy}
              title="Refresh YourComate branding"
              aria-label="Refresh YourComate branding"
            >
              <RefreshCw
                size={18}
                className={platformLoading ? 'tenant-brand-spin' : ''}
              />
            </button>
          </div>

          {platformLoading ? (
            <div className="platform-brand-loading">
              <span>
                <LoaderCircle size={21} className="tenant-brand-spin" />
                Loading YourComate branding...
              </span>
            </div>
          ) : (
            <div className="platform-branding-layout">
              <div className="platform-brand-preview">
                <div className="platform-sidebar-preview">
                  <div className="platform-logo-preview">
                    {previewPlatformLogoUrl ? (
                      <img
                        src={previewPlatformLogoUrl}
                        alt="YourComate logo"
                        onError={(event) => {
                          event.currentTarget.style.display = 'none';
                        }}
                      />
                    ) : (
                      'YC'
                    )}
                  </div>

                  <div className="platform-preview-copy">
                    <h2>{platformBranding.productName}</h2>
                    <p>{platformTagline || DEFAULT_PLATFORM_TAGLINE}</p>
                  </div>
                </div>
              </div>

              <form className="platform-brand-editor" onSubmit={savePlatformBranding}>
                <h2>
                  <ImagePlus size={21} /> Global Logo and Tagline
                </h2>
                <p>
                  These values are shared across every company. Only the Platform
                  Superadmin can change them.
                </p>

                <div className="platform-tagline-field">
                  <label htmlFor="platform-tagline">Sidebar tagline</label>
                  <div className="platform-tagline-input-wrap">
                    <Type size={18} />
                    <input
                      id="platform-tagline"
                      className="platform-tagline-input"
                      type="text"
                      value={platformTagline}
                      onChange={(event) => {
                        setPlatformTagline(event.target.value);
                        setPlatformMessage('');
                        setPlatformError('');
                      }}
                      maxLength={MAX_PLATFORM_TAGLINE_LENGTH}
                      placeholder={DEFAULT_PLATFORM_TAGLINE}
                      disabled={!canManagePlatformBranding || platformBusy}
                    />
                  </div>
                  <div className="platform-tagline-meta">
                    <span>Displayed below YourComate in the sidebar.</span>
                    <span>
                      {platformTagline.length}/{MAX_PLATFORM_TAGLINE_LENGTH}
                    </span>
                  </div>
                </div>

                {canManagePlatformBranding ? (
                  <>
                    <label
                      className={`platform-logo-dropzone${
                        platformBusy ? ' is-disabled' : ''
                      }`}
                    >
                      <span className="platform-logo-dropzone-icon">
                        <UploadCloud size={23} />
                      </span>
                      <span>
                        <strong>
                          {selectedPlatformFile
                            ? 'Choose a different YourComate logo'
                            : 'Select YourComate logo'}
                        </strong>
                        <span>JPG, JPEG, PNG, or WEBP · Maximum 3 MB</span>
                      </span>
                      <input
                        ref={platformFileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                        onChange={handlePlatformFileChange}
                        disabled={platformBusy}
                      />
                    </label>

                    {selectedPlatformFile && (
                      <div className="platform-logo-file-meta">
                        <CheckCircle2 size={17} />
                        <span>
                          {selectedPlatformFile.name} ·{' '}
                          {formatFileSize(selectedPlatformFile.size)}
                        </span>
                      </div>
                    )}

                    <div className="platform-brand-actions">
                      <button
                        type="submit"
                        className="platform-brand-save"
                        disabled={platformBusy || !safeText(platformTagline)}
                      >
                        {platformSaving ? (
                          <LoaderCircle size={17} className="tenant-brand-spin" />
                        ) : (
                          <Save size={17} />
                        )}
                        {platformSaving ? 'Saving Branding...' : 'Save Branding'}
                      </button>

                      <button
                        type="button"
                        className="platform-logo-remove"
                        onClick={removePlatformLogo}
                        disabled={!platformBranding.logo || platformBusy}
                      >
                        {platformRemoving ? (
                          <LoaderCircle size={17} className="tenant-brand-spin" />
                        ) : (
                          <Trash2 size={17} />
                        )}
                        {platformRemoving ? 'Removing...' : 'Remove Current Logo'}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="platform-brand-permission">
                    <ShieldCheck size={19} />
                    Only the Platform Superadmin can upload the YourComate logo or
                    change the global tagline.
                  </div>
                )}

                {platformMessage && (
                  <div className="platform-brand-message success">
                    <CheckCircle2 size={18} />
                    <span>{platformMessage}</span>
                  </div>
                )}

                {platformError && (
                  <div className="platform-brand-message error">
                    <span>{platformError}</span>
                  </div>
                )}
              </form>
            </div>
          )}
        </section>

      )}

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

    </div>
  );
}