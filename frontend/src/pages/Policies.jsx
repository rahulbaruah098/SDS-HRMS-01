import React, { useEffect, useMemo, useState } from 'react';
import {
  Upload,
  FileText,
  Download,
  Search,
  RefreshCw,
  ShieldCheck,
  CheckCircle2,
} from 'lucide-react';

import {
  getPolicies,
  uploadPolicy,
  downloadPolicy,
} from '../api/client';
import { useCustomAlert } from '../components/CustomAlertProvider.jsx';

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
  const alerts = useCustomAlert();

  const [policies, setPolicies] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [downloadingId, setDownloadingId] = useState('');

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
      alerts.error(error?.message || 'Unable to load policies.', 'Policies Load Failed');
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
      alerts.warning(validationError, 'Policy Validation');
      return;
    }

    setUploading(true);

    try {
      await uploadPolicy(form);

      alerts.success('Policy uploaded successfully.', 'Policy Uploaded');

      resetForm();
      await loadPolicies();
    } catch (error) {
      alerts.error(error?.message || 'Unable to upload policy.', 'Policy Upload Failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(policy) {
    const policyId = policy.id || policy._id;

    if (!policyId) {
      alerts.error('Invalid policy selected.', 'Invalid Policy');
      return;
    }

    setDownloadingId(policyId);

    try {
      await downloadPolicy(
        policyId,
        policy.file_original_name || `${policy.document_id || 'policy'}`
      );

      alerts.success('Policy download started successfully.', 'Download Started');
    } catch (error) {
      alerts.error(error?.message || 'Unable to download policy.', 'Policy Download Failed');
    } finally {
      setDownloadingId('');
    }
  }

  return (
    <div className="policies-page">
      <style>{`
        .policies-page {
          --policy-ink: #101a3a;
          --policy-ink-soft: #596483;
          --policy-violet: #6254da;
          --policy-violet-deep: #342b78;
          --policy-blue: #3766db;
          --policy-teal: #18aaa8;
          --policy-sky: #edf8ff;
          --policy-lilac: #f1efff;
          --policy-paper: #fbfcff;
          --policy-line: rgba(65, 55, 161, 0.15);
          --policy-flat-blue: #b9d7ff;
          --policy-flat-violet: #c9c0ff;
          --policy-flat-teal: #aee6d9;

          display: grid;
          gap: 22px;
          width: 100%;
          color: var(--policy-ink);
          font-family: var(--yc-ui, var(--body), inherit);
        }

        .policy-hero {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          padding: clamp(24px, 2.8vw, 36px);
          border: 1px solid rgba(171, 181, 211, 0.72);
          border-radius: clamp(28px, 2.5vw, 40px);
          color: var(--policy-ink);
          background:
            radial-gradient(circle at 8% 8%, rgba(121, 219, 238, 0.34), transparent 31%),
            radial-gradient(circle at 92% 12%, rgba(191, 190, 249, 0.3), transparent 34%),
            linear-gradient(135deg, #f1fbff 0%, #fffdf8 48%, #f8f2ff 100%);
          box-shadow:
            12px 14px 0 var(--policy-flat-blue),
            0 28px 48px rgba(34, 38, 110, 0.13);
        }

        .policy-hero::before {
          content: "";
          position: absolute;
          inset: 0;
          z-index: -2;
          pointer-events: none;
          opacity: 0.42;
          background-image:
            linear-gradient(rgba(65, 55, 161, 0.035) 1px, transparent 1px),
            linear-gradient(90deg, rgba(65, 55, 161, 0.035) 1px, transparent 1px);
          background-size: 42px 42px;
        }

        .policy-hero::after {
          content: "";
          position: absolute;
          z-index: -1;
          width: clamp(160px, 19vw, 285px);
          aspect-ratio: 1;
          right: clamp(-105px, -7vw, -55px);
          top: clamp(-115px, -8vw, -60px);
          border: 1px solid rgba(65, 55, 161, 0.12);
          border-radius: 34% 66% 58% 42% / 44% 38% 62% 56%;
          background: linear-gradient(145deg, rgba(105, 217, 208, 0.72), rgba(121, 189, 242, 0.72));
          transform: rotate(18deg);
        }

        .policy-hero-inner {
          position: relative;
          z-index: 2;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: center;
          gap: 26px;
        }

        .policy-kicker {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          width: fit-content;
          max-width: 100%;
          margin-bottom: 14px;
          padding: 9px 13px;
          border-radius: 999px;
          color: #ffffff;
          background: var(--policy-violet-deep);
          font-size: clamp(8px, 0.7vw, 10px);
          font-weight: 950;
          line-height: 1;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }

        .policy-hero h1 {
          max-width: 820px;
          margin: 0;
          color: var(--policy-ink);
          font-family: var(--yc-display, var(--heading), inherit);
          font-size: clamp(34px, 4.4vw, 66px);
          font-weight: 760;
          line-height: 0.94;
          letter-spacing: -0.055em;
        }

        .policy-hero p {
          max-width: 780px;
          margin: 14px 0 0;
          color: var(--policy-ink-soft);
          font-size: clamp(13px, 1vw, 16px);
          line-height: 1.68;
        }

        .policy-hero-stat {
          min-width: 190px;
          padding: 20px;
          border: 1px solid rgba(159, 169, 205, 0.58);
          border-radius: 22px;
          color: var(--policy-ink);
          background: rgba(255, 255, 255, 0.86);
          box-shadow:
            7px 9px 0 var(--policy-flat-violet),
            0 18px 30px rgba(15, 20, 75, 0.09);
        }

        .policy-hero-stat span {
          display: block;
          color: var(--policy-ink-soft);
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .policy-hero-stat strong {
          display: block;
          margin-top: 8px;
          color: var(--policy-ink);
          font-family: var(--yc-display, var(--heading), inherit);
          font-size: clamp(32px, 3vw, 46px);
          font-weight: 800;
          line-height: 1;
          letter-spacing: -0.04em;
        }

        .policy-card {
          overflow: hidden;
          min-width: 0;
          border: 1px solid rgba(171, 181, 211, 0.72);
          border-radius: clamp(24px, 2vw, 32px);
          color: var(--policy-ink);
          background:
            linear-gradient(145deg, rgba(255, 255, 255, 0.99), rgba(244, 249, 255, 0.98));
          box-shadow:
            9px 11px 0 #d1dcfa,
            0 24px 42px rgba(34, 38, 110, 0.1);
        }

        .policy-card:nth-of-type(2) {
          background:
            linear-gradient(145deg, #f4fbff 0%, #f8f1ff 56%, #fffaf0 100%);
          box-shadow:
            9px 11px 0 #c9ddf5,
            0 24px 42px rgba(34, 38, 110, 0.1);
        }

        .policy-card-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 14px;
          padding: 22px 24px;
          border-bottom: 1px solid rgba(65, 55, 161, 0.12);
          background: rgba(255, 255, 255, 0.68);
        }

        .policy-card-title {
          display: flex;
          align-items: center;
          gap: 12px;
          margin: 0;
          color: var(--policy-ink);
          font-family: var(--yc-display, var(--heading), inherit);
          font-size: clamp(22px, 2vw, 30px);
          font-weight: 760;
          line-height: 1;
          letter-spacing: -0.03em;
        }

        .policy-card-subtitle {
          margin: 7px 0 0;
          color: var(--policy-ink-soft);
          font-size: 13px;
          line-height: 1.55;
        }

        .policy-icon-box {
          display: inline-flex;
          flex: 0 0 auto;
          align-items: center;
          justify-content: center;
          width: 44px;
          height: 44px;
          border: 1px solid rgba(52, 43, 120, 0.15);
          border-radius: 15px;
          color: #ffffff;
          background: linear-gradient(145deg, #4f72df, #2bb9b5);
          box-shadow: 4px 5px 0 rgba(52, 43, 120, 0.76);
        }

        .policy-form {
          display: grid;
          grid-template-columns: 0.75fr 1fr;
          gap: 18px;
          padding: 24px;
        }

        .policy-field {
          display: grid;
          min-width: 0;
          gap: 8px;
        }

        .policy-field.full {
          grid-column: 1 / -1;
        }

        .policy-field label {
          color: #334164;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 0.015em;
        }

        .policy-field input,
        .policy-field textarea {
          width: 100%;
          min-width: 0;
          border: 1px solid rgba(159, 169, 205, 0.62);
          border-radius: 14px;
          outline: none;
          color: var(--policy-ink);
          background: rgba(255, 255, 255, 0.86);
          padding: 12px 13px;
          font: inherit;
          transition:
            border-color 180ms ease,
            box-shadow 180ms ease,
            background 180ms ease;
        }

        .policy-field input:hover,
        .policy-field textarea:hover {
          border-color: rgba(98, 84, 218, 0.34);
        }

        .policy-field input:focus,
        .policy-field textarea:focus {
          border-color: var(--policy-violet);
          background: #ffffff;
          box-shadow: 0 0 0 4px rgba(98, 84, 218, 0.11);
        }

        .policy-field textarea {
          min-height: 118px;
          resize: vertical;
          line-height: 1.6;
        }

        .policy-file-input {
          padding: 16px;
          border: 1px dashed rgba(98, 84, 218, 0.38);
          border-radius: 18px;
          background:
            linear-gradient(145deg, rgba(237, 248, 255, 0.82), rgba(248, 241, 255, 0.76));
        }

        .policy-file-input input {
          padding: 0;
          border: none;
          box-shadow: none;
          background: transparent;
        }

        .policy-file-input input:focus {
          box-shadow: none;
        }

        .policy-help {
          margin-top: 9px;
          color: var(--policy-ink-soft);
          font-size: 11px;
          font-weight: 750;
          line-height: 1.5;
        }

        .policy-actions {
          grid-column: 1 / -1;
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 12px;
        }

        .policy-btn {
          appearance: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-height: 42px;
          padding: 12px 16px;
          border: 1px solid transparent;
          border-radius: 14px;
          cursor: pointer;
          font: inherit;
          font-weight: 900;
          line-height: 1;
          text-decoration: none;
          white-space: nowrap;
          transition:
            transform 180ms ease,
            box-shadow 180ms ease,
            border-color 180ms ease,
            filter 180ms ease;
        }

        .policy-btn:hover {
          transform: translateY(-2px);
          filter: saturate(1.04);
        }

        .policy-btn.primary {
          border-color: rgba(52, 43, 120, 0.16);
          color: #ffffff;
          background: linear-gradient(145deg, #4f72df, #2bb9b5);
          box-shadow:
            5px 6px 0 rgba(52, 43, 120, 0.8),
            0 12px 22px rgba(55, 102, 219, 0.16);
        }

        .policy-btn.secondary {
          border-color: rgba(98, 84, 218, 0.18);
          color: var(--policy-violet-deep);
          background: #f1efff;
          box-shadow: 4px 5px 0 rgba(98, 84, 218, 0.14);
        }

        .policy-btn.success {
          border-color: rgba(19, 115, 111, 0.18);
          color: #ffffff;
          background: linear-gradient(145deg, #2bb9b5, #2f8f88);
          box-shadow:
            5px 6px 0 rgba(19, 115, 111, 0.78),
            0 12px 22px rgba(24, 170, 168, 0.16);
        }

        .policy-btn:disabled {
          cursor: not-allowed;
          opacity: 0.62;
          transform: none;
          box-shadow: none;
          filter: none;
        }

        .policy-btn:focus-visible,
        .policy-field input:focus-visible,
        .policy-field textarea:focus-visible,
        .policy-search input:focus-visible {
          outline: 3px solid rgba(98, 84, 218, 0.2);
          outline-offset: 2px;
        }

        .policy-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding: 18px 24px;
          border-bottom: 1px solid rgba(65, 55, 161, 0.12);
          background: rgba(255, 255, 255, 0.7);
        }

        .policy-search {
          display: flex;
          flex: 1;
          align-items: center;
          gap: 10px;
          max-width: 500px;
          border: 1px solid rgba(159, 169, 205, 0.62);
          border-radius: 14px;
          padding: 0 13px;
          color: var(--policy-ink);
          background: rgba(255, 255, 255, 0.86);
          transition:
            border-color 180ms ease,
            box-shadow 180ms ease,
            background 180ms ease;
        }

        .policy-search:focus-within {
          border-color: var(--policy-violet);
          background: #ffffff;
          box-shadow: 0 0 0 4px rgba(98, 84, 218, 0.11);
        }

        .policy-search svg {
          flex: 0 0 auto;
          color: var(--policy-violet);
        }

        .policy-search input {
          width: 100%;
          min-width: 0;
          border: none;
          outline: none;
          color: var(--policy-ink);
          background: transparent;
          padding: 12px 0;
          font: inherit;
        }

        .policy-count {
          display: inline-flex;
          align-items: center;
          width: fit-content;
          padding: 8px 11px;
          border-radius: 999px;
          color: #13736f;
          background: #dff8f3;
          font-size: 11px;
          font-weight: 900;
          line-height: 1;
          white-space: nowrap;
        }

        .policy-table-wrap {
          width: 100%;
          overflow-x: auto;
          scrollbar-width: thin;
          scrollbar-color: rgba(98, 84, 218, 0.35) transparent;
        }

        .policy-table-wrap::-webkit-scrollbar {
          height: 8px;
        }

        .policy-table-wrap::-webkit-scrollbar-thumb {
          border-radius: 999px;
          background: rgba(98, 84, 218, 0.35);
        }

        .policy-table {
          width: 100%;
          min-width: 920px;
          border-collapse: separate;
          border-spacing: 0;
        }

        .policy-table th {
          padding: 14px 16px;
          border-bottom: 1px solid rgba(65, 55, 161, 0.12);
          color: #4f5e7f;
          background: rgba(241, 239, 255, 0.78);
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0.07em;
          text-align: left;
          text-transform: uppercase;
        }

        .policy-table td {
          padding: 16px;
          border-bottom: 1px solid rgba(65, 55, 161, 0.09);
          color: #334164;
          background: rgba(255, 255, 255, 0.62);
          vertical-align: top;
          font-size: 13px;
          transition: background 180ms ease;
        }

        .policy-table tbody tr:hover td {
          background: rgba(237, 246, 255, 0.82);
        }

        .policy-table tbody tr:last-child td {
          border-bottom: 0;
        }

        .policy-doc-id {
          color: var(--policy-violet);
          font-size: 12px;
          font-weight: 950;
          white-space: nowrap;
        }

        .policy-title {
          margin-bottom: 5px;
          color: var(--policy-ink);
          font-size: 14px;
          font-weight: 900;
          line-height: 1.3;
        }

        .policy-summary {
          max-width: 430px;
          color: var(--policy-ink-soft);
          font-size: 12px;
          line-height: 1.55;
        }

        .policy-file-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          border: 1px solid rgba(98, 84, 218, 0.13);
          border-radius: 13px;
          color: #4a5680;
          background: #f1efff;
          font-size: 11px;
          font-weight: 850;
          white-space: nowrap;
        }

        .policy-status {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 7px 10px;
          border-radius: 999px;
          color: #13736f;
          background: #dff8f3;
          font-size: 10px;
          font-weight: 900;
          line-height: 1;
          text-transform: capitalize;
          white-space: nowrap;
        }

        .policy-empty {
          display: grid;
          place-items: center;
          padding: 44px 24px;
          color: var(--policy-ink-soft);
          text-align: center;
          background:
            linear-gradient(145deg, rgba(237, 248, 255, 0.58), rgba(248, 241, 255, 0.52));
        }

        .policy-empty svg {
          margin-bottom: 12px;
          color: var(--policy-violet);
        }

        .policy-empty strong {
          display: block;
          margin-bottom: 6px;
          color: var(--policy-ink);
          font-size: 17px;
          font-weight: 900;
        }

        .policy-empty span {
          font-size: 12px;
          line-height: 1.5;
        }

        @media (hover: hover) and (pointer: fine) {
          .policy-btn.primary:hover {
            box-shadow:
              7px 8px 0 rgba(52, 43, 120, 0.8),
              0 16px 25px rgba(55, 102, 219, 0.2);
          }

          .policy-btn.secondary:hover {
            box-shadow: 6px 7px 0 rgba(98, 84, 218, 0.17);
          }

          .policy-btn.success:hover {
            box-shadow:
              7px 8px 0 rgba(19, 115, 111, 0.78),
              0 16px 25px rgba(24, 170, 168, 0.2);
          }
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
          .policies-page {
            gap: 17px;
          }

          .policy-hero {
            padding: 20px;
            border-radius: 24px;
            box-shadow:
              7px 8px 0 var(--policy-flat-blue),
              0 18px 30px rgba(34, 38, 110, 0.1);
          }

          .policy-hero h1 {
            font-size: clamp(31px, 9.2vw, 43px);
          }

          .policy-card {
            border-radius: 23px;
            box-shadow:
              6px 7px 0 #d1dcfa,
              0 16px 28px rgba(34, 38, 110, 0.08);
          }

          .policy-card:nth-of-type(2) {
            box-shadow:
              6px 7px 0 #c9ddf5,
              0 16px 28px rgba(34, 38, 110, 0.08);
          }

          .policy-form,
          .policy-card-head,
          .policy-toolbar {
            padding: 18px;
          }

          .policy-card-title {
            align-items: flex-start;
            font-size: 23px;
          }

          .policy-toolbar .policy-actions,
          .policy-actions {
            width: 100%;
            justify-content: stretch;
          }

          .policy-toolbar .policy-actions {
            display: grid;
            grid-template-columns: 1fr;
          }

          .policy-btn {
            width: 100%;
          }

          .policy-count {
            justify-content: center;
            width: 100%;
            min-height: 38px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .policies-page *,
          .policies-page *::before,
          .policies-page *::after {
            scroll-behavior: auto !important;
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
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