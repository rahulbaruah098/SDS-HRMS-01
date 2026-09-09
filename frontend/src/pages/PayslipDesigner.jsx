import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BadgeCheck,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  Eye,
  EyeOff,
  FileCheck2,
  FileText,
  Image,
  LayoutTemplate,
  Loader2,
  LockKeyhole,
  Palette,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Type,
  X,
} from 'lucide-react';

import { api } from '../api/client';

const DESIGNER_HANDOFF_KEY = 'sds_hrms_payslip_designer_organisation';
const MANAGER_ROLES = new Set([
  'super_admin',
  'admin',
  'hr_admin',
  'hr_manager',
  'hr',
]);

const EDITOR_TABS = [
  { key: 'document', label: 'Document', icon: FileText },
  { key: 'header', label: 'Header', icon: Image },
  { key: 'employee', label: 'Employee Fields', icon: Type },
  { key: 'payroll', label: 'Payroll Tables', icon: SlidersHorizontal },
  { key: 'sections', label: 'Sections', icon: LayoutTemplate },
  { key: 'footer', label: 'Footer', icon: FileCheck2 },
];

function safeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function normalizeKey(value) {
  return safeText(value)
    .toLowerCase()
    .replaceAll('-', '_')
    .replaceAll(' ', '_');
}

function normalizeRoles(user = {}) {
  const values = [
    user.role,
    ...(Array.isArray(user.roles)
      ? user.roles
      : typeof user.roles === 'string'
        ? user.roles.split(',')
        : []),
  ];

  return Array.from(new Set(values.map(normalizeKey).filter(Boolean)));
}

function deepClone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function stableJson(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch (_error) {
    return '';
  }
}

function profileReference(profile = {}) {
  return safeText(
    profile.organisation_id ||
      profile.organization_id ||
      profile.organisation_code ||
      profile.organization_code ||
      profile.profile_key,
    'tenant',
  );
}

function profileName(profile = {}) {
  return safeText(
    profile.organisation_name || profile.organization_name,
    'Company',
  );
}

function logoSourceLabel(source = '') {
  const normalized = normalizeKey(source);
  if (normalized === 'payroll_branding') return 'Custom payroll logo';
  if (normalized === 'organisation' || normalized === 'organization') {
    return 'Organisation logo fallback';
  }
  if (normalized === 'tenant') return 'Company logo fallback';
  return 'Initials fallback';
}

function initials(value = '') {
  const words = safeText(value)
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return 'YC';
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words
    .slice(0, 4)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

function sectionVisible(design = {}, sectionKey = '') {
  if (sectionKey === 'employee_info') return design.employee_info?.visible !== false;
  if (sectionKey === 'earnings_deductions') {
    return design.earnings_deductions?.visible !== false;
  }
  if (sectionKey === 'advances') return design.advances?.visible !== false;
  if (sectionKey === 'transfer') return design.transfer?.visible !== false;
  if (sectionKey === 'footer') return design.footer?.visible !== false;
  return true;
}

function formatVersion(value) {
  const number = Number(value || 0);
  return number > 0 ? `v${number}` : 'System default';
}

function Toggle({ checked, onChange, disabled = false, label, description = '' }) {
  return (
    <label className={`pd-toggle-row ${disabled ? 'is-disabled' : ''}`}>
      <span>
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
      <button
        type="button"
        className={`pd-switch ${checked ? 'is-on' : ''}`}
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
        role="switch"
        aria-checked={checked}
        aria-label={label}
      >
        <span />
      </button>
    </label>
  );
}

function Field({ label, hint = '', children, wide = false }) {
  return (
    <label className={`pd-field ${wide ? 'is-wide' : ''}`}>
      <span className="pd-field-label">{label}</span>
      {children}
      {hint ? <small className="pd-field-hint">{hint}</small> : null}
    </label>
  );
}

function ColorField({ label, value, onChange }) {
  const normalized = /^#[0-9A-Fa-f]{6}$/.test(safeText(value))
    ? safeText(value)
    : '#000000';

  return (
    <Field label={label}>
      <div className="pd-color-input">
        <input
          type="color"
          value={normalized}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          aria-label={`${label} color picker`}
        />
        <input
          type="text"
          value={safeText(value)}
          maxLength={7}
          onChange={(event) => onChange(event.target.value)}
          onBlur={(event) => {
            const next = safeText(event.target.value);
            if (!/^#[0-9A-Fa-f]{6}$/.test(next)) {
              onChange(normalized.toUpperCase());
            } else {
              onChange(next.toUpperCase());
            }
          }}
          aria-label={`${label} hex value`}
        />
      </div>
    </Field>
  );
}

function ConfirmationModal({
  open,
  title,
  description,
  confirmLabel,
  confirmTone = 'primary',
  busy = false,
  onConfirm,
  onClose,
}) {
  if (!open) return null;

  return (
    <div className="pd-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="pd-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pd-confirm-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="pd-modal-icon">
          <AlertTriangle size={22} />
        </div>
        <div className="pd-modal-copy">
          <h3 id="pd-confirm-title">{title}</h3>
          <p>{description}</p>
        </div>
        <div className="pd-modal-actions">
          <button type="button" className="pd-btn secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={`pd-btn ${confirmTone === 'danger' ? 'danger' : 'primary'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? <Loader2 size={16} className="pd-spin" /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PayslipDesigner({ setPage, user = {} }) {
  const roles = useMemo(() => normalizeRoles(user), [user]);
  const canManage = useMemo(
    () => roles.some((role) => MANAGER_ROLES.has(role)),
    [roles],
  );

  const [catalog, setCatalog] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [selectedReference, setSelectedReference] = useState('');
  const [profile, setProfile] = useState(null);
  const [design, setDesign] = useState(null);
  const [baselineDesign, setBaselineDesign] = useState(null);
  const [activeTab, setActiveTab] = useState('document');

  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewSource, setPreviewSource] = useState('');
  const [autoPreview, setAutoPreview] = useState(true);

  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [previewError, setPreviewError] = useState('');

  const [pendingOrganisation, setPendingOrganisation] = useState('');
  const [resetMode, setResetMode] = useState('');
  const previewRequestRef = useRef(0);
  const messageTimerRef = useRef(null);

  const dirty = useMemo(
    () => Boolean(design && baselineDesign && stableJson(design) !== stableJson(baselineDesign)),
    [design, baselineDesign],
  );

  const selectionMode = profiles.length <= 1 ? 'single' : 'multiple';

  const selectedProfileSummary = useMemo(
    () => profiles.find((item) => profileReference(item) === selectedReference) || profile,
    [profiles, selectedReference, profile],
  );

  const activeVersion = Number(profile?.active_version || 0);
  const draftVersion = Number(profile?.draft_version || 0);
  const hasDraft = Boolean(profile?.has_draft);
  const hasCustomActiveDesign = Boolean(profile?.has_active_custom_design);

  const flash = useCallback((text) => {
    setMessage(text);
    if (messageTimerRef.current) {
      window.clearTimeout(messageTimerRef.current);
    }
    messageTimerRef.current = window.setTimeout(() => setMessage(''), 5000);
  }, []);

  useEffect(() => () => {
    if (messageTimerRef.current) window.clearTimeout(messageTimerRef.current);
  }, []);

  const updateDesign = useCallback((path, value) => {
    setDesign((current) => {
      if (!current) return current;
      const next = deepClone(current);
      const parts = Array.isArray(path) ? path : safeText(path).split('.');
      let cursor = next;
      for (let index = 0; index < parts.length - 1; index += 1) {
        const key = parts[index];
        if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {};
        cursor = cursor[key];
      }
      cursor[parts[parts.length - 1]] = value;
      return next;
    });
    setError('');
  }, []);

  const replaceProfile = useCallback((nextProfile) => {
    if (!nextProfile) return;
    setProfile(nextProfile);
    const reference = profileReference(nextProfile);
    setProfiles((current) =>
      current.map((item) =>
        profileReference(item) === reference ? { ...item, ...nextProfile } : item,
      ),
    );
  }, []);

  const requestPreview = useCallback(async (designValue, referenceValue, silent = false) => {
    if (!designValue || !referenceValue) return;
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;

    if (!silent) setPreviewLoading(true);
    setPreviewError('');

    try {
      const data = await api(
        `/payroll-branding/profiles/${encodeURIComponent(referenceValue)}/preview`,
        {
          method: 'POST',
          body: JSON.stringify({ design: designValue }),
          timeoutMs: 30000,
        },
      );

      if (previewRequestRef.current !== requestId) return;
      setPreviewHtml(safeText(data?.preview?.html));
      setPreviewSource(safeText(data?.preview?.source, 'unsaved'));
    } catch (requestError) {
      if (previewRequestRef.current !== requestId) return;
      setPreviewError(
        requestError?.message || 'Unable to generate the payslip preview.',
      );
    } finally {
      if (previewRequestRef.current === requestId) {
        setPreviewLoading(false);
      }
    }
  }, []);

  const loadProfile = useCallback(async (reference, options = {}) => {
    if (!reference) return;
    const { silent = false } = options;

    if (!silent) setProfileLoading(true);
    setError('');
    setPreviewError('');

    try {
      const data = await api(
        `/payroll-branding/profiles/${encodeURIComponent(reference)}`,
      );
      const nextProfile = data?.profile;
      if (!nextProfile) throw new Error('Payroll branding profile was not returned.');

      const nextDesign = deepClone(
        nextProfile.draft_design ||
          nextProfile.active_design ||
          catalog?.default_design ||
          {},
      );

      replaceProfile(nextProfile);
      setSelectedReference(profileReference(nextProfile));
      setDesign(nextDesign);
      setBaselineDesign(deepClone(nextDesign));
      setPreviewHtml('');
      setPreviewSource('');
      await requestPreview(nextDesign, profileReference(nextProfile));
    } catch (requestError) {
      setError(
        requestError?.message || 'Unable to load the selected organisation.',
      );
    } finally {
      if (!silent) setProfileLoading(false);
    }
  }, [catalog?.default_design, replaceProfile, requestPreview]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      if (!canManage) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError('');

      try {
        const [catalogData, profilesData] = await Promise.all([
          api('/payroll-branding/catalog'),
          api('/payroll-branding/profiles'),
        ]);

        if (cancelled) return;

        const nextCatalog = catalogData?.catalog || {};
        const nextProfiles = Array.isArray(profilesData?.profiles)
          ? profilesData.profiles
          : [];

        setCatalog(nextCatalog);
        setProfiles(nextProfiles);

        let preferredReference = '';
        try {
          preferredReference = safeText(
            sessionStorage.getItem(DESIGNER_HANDOFF_KEY),
          );
          sessionStorage.removeItem(DESIGNER_HANDOFF_KEY);
        } catch (_error) {
          preferredReference = '';
        }

        const preferredProfile = nextProfiles.find(
          (item) => profileReference(item) === preferredReference,
        );
        const initialProfile = preferredProfile || nextProfiles[0] || null;

        if (!initialProfile) {
          throw new Error('No organisation is available for payroll branding.');
        }

        const initialReference = profileReference(initialProfile);
        setSelectedReference(initialReference);
        setProfile(initialProfile);

        const initialDesign = deepClone(
          initialProfile.draft_design ||
            initialProfile.active_design ||
            nextCatalog.default_design ||
            {},
        );
        setDesign(initialDesign);
        setBaselineDesign(deepClone(initialDesign));

        const profileData = await api(
          `/payroll-branding/profiles/${encodeURIComponent(initialReference)}`,
        );
        if (cancelled) return;

        const freshProfile = profileData?.profile || initialProfile;
        const freshDesign = deepClone(
          freshProfile.draft_design ||
            freshProfile.active_design ||
            nextCatalog.default_design ||
            {},
        );
        setProfile(freshProfile);
        setProfiles((current) =>
          current.map((item) =>
            profileReference(item) === profileReference(freshProfile)
              ? { ...item, ...freshProfile }
              : item,
          ),
        );
        setSelectedReference(profileReference(freshProfile));
        setDesign(freshDesign);
        setBaselineDesign(deepClone(freshDesign));
        await requestPreview(freshDesign, profileReference(freshProfile));
      } catch (requestError) {
        if (!cancelled) {
          setError(
            requestError?.message || 'Unable to load the Payslip Designer.',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
      previewRequestRef.current += 1;
    };
  }, [canManage, requestPreview]);

  useEffect(() => {
    if (!autoPreview || !design || !selectedReference || loading || profileLoading) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      requestPreview(design, selectedReference, true);
    }, 550);

    return () => window.clearTimeout(timer);
  }, [
    autoPreview,
    design,
    selectedReference,
    loading,
    profileLoading,
    requestPreview,
  ]);

  const saveDraft = useCallback(async (designValue = design, options = {}) => {
    if (!designValue || !selectedReference) return null;
    const { quiet = false } = options;
    setSaving(true);
    setError('');

    try {
      const data = await api(
        `/payroll-branding/profiles/${encodeURIComponent(selectedReference)}/design/draft`,
        {
          method: 'PUT',
          body: JSON.stringify({ design: designValue }),
        },
      );
      const nextProfile = data?.profile;
      if (!nextProfile) throw new Error('Saved payslip draft was not returned.');
      const normalized = deepClone(nextProfile.draft_design || designValue);
      replaceProfile(nextProfile);
      setDesign(normalized);
      setBaselineDesign(deepClone(normalized));
      if (!quiet) flash(data?.message || 'Payslip design draft saved.');
      return nextProfile;
    } catch (requestError) {
      setError(requestError?.message || 'Unable to save the payslip design draft.');
      return null;
    } finally {
      setSaving(false);
    }
  }, [design, selectedReference, replaceProfile, flash]);

  async function activateDesign() {
    if (!selectedReference || !design) return;
    setActivating(true);
    setError('');

    try {
      if (dirty || !hasDraft) {
        const saved = await saveDraft(design, { quiet: true });
        if (!saved) return;
      }

      const data = await api(
        `/payroll-branding/profiles/${encodeURIComponent(selectedReference)}/design/activate`,
        {
          method: 'POST',
          body: JSON.stringify({}),
        },
      );
      const nextProfile = data?.profile;
      if (!nextProfile) throw new Error('Activated payslip design was not returned.');
      const normalized = deepClone(nextProfile.draft_design || nextProfile.active_design || design);
      replaceProfile(nextProfile);
      setDesign(normalized);
      setBaselineDesign(deepClone(normalized));
      flash(data?.message || 'Payslip design activated successfully.');
      await requestPreview(normalized, selectedReference);
    } catch (requestError) {
      setError(requestError?.message || 'Unable to activate the payslip design.');
    } finally {
      setActivating(false);
    }
  }

  async function confirmReset() {
    if (!selectedReference || !resetMode) return;
    setResetting(true);
    setError('');

    try {
      const data = await api(
        `/payroll-branding/profiles/${encodeURIComponent(selectedReference)}/design/reset`,
        {
          method: 'POST',
          body: JSON.stringify({
            mode: resetMode === 'system_default' ? 'system_default' : 'active',
          }),
        },
      );
      const nextProfile = data?.profile;
      if (!nextProfile) throw new Error('Reset payslip design was not returned.');
      const normalized = deepClone(nextProfile.draft_design || nextProfile.active_design || catalog?.default_design || {});
      replaceProfile(nextProfile);
      setDesign(normalized);
      setBaselineDesign(deepClone(normalized));
      setResetMode('');
      flash(
        resetMode === 'system_default'
          ? 'Draft reset to the system default payslip.'
          : 'Draft reset to the active payslip design.',
      );
      await requestPreview(normalized, selectedReference);
    } catch (requestError) {
      setError(requestError?.message || 'Unable to reset the payslip design.');
    } finally {
      setResetting(false);
    }
  }

  async function switchOrganisation(reference) {
    setPendingOrganisation('');
    await loadProfile(reference);
  }

  function requestOrganisationChange(reference) {
    if (!reference || reference === selectedReference) return;
    if (dirty) {
      setPendingOrganisation(reference);
      return;
    }
    switchOrganisation(reference);
  }

  function moveSection(sectionKey, direction) {
    const order = Array.isArray(design?.section_order)
      ? [...design.section_order]
      : [];
    const index = order.indexOf(sectionKey);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    updateDesign('section_order', order);
  }

  function setSectionVisibility(sectionKey, visible) {
    const mapping = {
      employee_info: 'employee_info.visible',
      earnings_deductions: 'earnings_deductions.visible',
      advances: 'advances.visible',
      transfer: 'transfer.visible',
      footer: 'footer.visible',
    };
    if (mapping[sectionKey]) updateDesign(mapping[sectionKey], visible);
  }

  function toggleEmployeeField(fieldKey, visible) {
    const current = Array.isArray(design?.employee_info?.fields)
      ? [...design.employee_info.fields]
      : [];
    const exists = current.includes(fieldKey);

    if (visible && !exists) current.push(fieldKey);
    if (!visible && exists) current.splice(current.indexOf(fieldKey), 1);
    updateDesign('employee_info.fields', current);
  }

  function moveEmployeeField(fieldKey, direction) {
    const current = Array.isArray(design?.employee_info?.fields)
      ? [...design.employee_info.fields]
      : [];
    const index = current.indexOf(fieldKey);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= current.length) return;
    [current[index], current[target]] = [current[target], current[index]];
    updateDesign('employee_info.fields', current);
  }

  function updateEmployeeLabel(fieldKey, value) {
    const labels = { ...(design?.employee_info?.labels || {}) };
    if (safeText(value)) labels[fieldKey] = value;
    else delete labels[fieldKey];
    updateDesign('employee_info.labels', labels);
  }

  function goBack() {
    if (typeof setPage === 'function') setPage('settings');
  }

  if (!canManage) {
    return (
      <div className="pd-page pd-centered-state">
        <style>{designerStyles}</style>
        <div className="pd-state-card">
          <LockKeyhole size={34} />
          <h2>Payslip Designer access restricted</h2>
          <p>Only authorized HR or administrator roles can manage payslip designs.</p>
          <button type="button" className="pd-btn secondary" onClick={goBack}>
            <ArrowLeft size={16} /> Back to Settings
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="pd-page pd-centered-state">
        <style>{designerStyles}</style>
        <div className="pd-loading-stack">
          <Loader2 size={30} className="pd-spin" />
          <strong>Loading Payslip Designer…</strong>
          <span>Preparing organisation branding and the current design.</span>
        </div>
      </div>
    );
  }

  if (!design || !profile || !catalog) {
    return (
      <div className="pd-page pd-centered-state">
        <style>{designerStyles}</style>
        <div className="pd-state-card error">
          <AlertTriangle size={34} />
          <h2>Designer could not be loaded</h2>
          <p>{error || 'No payroll branding profile is available.'}</p>
          <div className="pd-state-actions">
            <button type="button" className="pd-btn secondary" onClick={goBack}>
              <ArrowLeft size={16} /> Back
            </button>
            <button
              type="button"
              className="pd-btn primary"
              onClick={() => window.location.reload()}
            >
              <RefreshCw size={16} /> Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const sectionCatalog = Array.isArray(catalog.sections) ? catalog.sections : [];
  const sectionByKey = Object.fromEntries(
    sectionCatalog.map((item) => [item.key, item]),
  );
  const sectionOrder = Array.isArray(design.section_order)
    ? design.section_order
    : sectionCatalog.map((item) => item.key);
  const employeeCatalog = Array.isArray(catalog.employee_fields)
    ? catalog.employee_fields
    : [];
  const visibleEmployeeFields = Array.isArray(design.employee_info?.fields)
    ? design.employee_info.fields
    : [];
  const visibleIndex = new Map(
    visibleEmployeeFields.map((fieldKey, index) => [fieldKey, index]),
  );

  return (
    <div className="pd-page">
      <style>{designerStyles}</style>

      <header className="pd-topbar">
        <div className="pd-title-wrap">
          <button type="button" className="pd-icon-btn" onClick={goBack} aria-label="Back to settings">
            <ArrowLeft size={19} />
          </button>
          <div>
            <div className="pd-kicker">
              <ShieldCheck size={14} /> Payroll presentation
            </div>
            <h1>Payslip Designer</h1>
            <p>Customize how payslips look without changing payroll calculations.</p>
          </div>
        </div>

        <div className="pd-top-actions">
          <div className={`pd-save-state ${dirty ? 'is-dirty' : ''}`}>
            {dirty ? <span /> : <Check size={14} />}
            {dirty ? 'Unsaved changes' : 'Draft saved'}
          </div>
          <button
            type="button"
            className="pd-btn secondary"
            onClick={() => requestPreview(design, selectedReference)}
            disabled={previewLoading}
          >
            {previewLoading ? <Loader2 size={16} className="pd-spin" /> : <Eye size={16} />}
            Refresh Preview
          </button>
          <button
            type="button"
            className="pd-btn secondary"
            onClick={() => saveDraft()}
            disabled={saving || activating || !dirty}
          >
            {saving ? <Loader2 size={16} className="pd-spin" /> : <Save size={16} />}
            Save Draft
          </button>
          <button
            type="button"
            className="pd-btn primary"
            onClick={activateDesign}
            disabled={saving || activating}
          >
            {activating ? <Loader2 size={16} className="pd-spin" /> : <BadgeCheck size={16} />}
            {dirty ? 'Save & Activate' : 'Activate Design'}
          </button>
        </div>
      </header>

      {message ? (
        <div className="pd-banner success">
          <CheckCircle2 size={17} />
          <span>{message}</span>
          <button type="button" onClick={() => setMessage('')} aria-label="Dismiss message">
            <X size={15} />
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="pd-banner error">
          <AlertTriangle size={17} />
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} aria-label="Dismiss error">
            <X size={15} />
          </button>
        </div>
      ) : null}

      <section className="pd-context-card">
        <div className="pd-context-main">
          <div className="pd-org-mark">
            {profile.effective_logo_url ? (
              <img src={profile.effective_logo_url} alt="" />
            ) : (
              <span>{initials(profileName(profile))}</span>
            )}
          </div>
          <div className="pd-org-copy">
            <span>Designing payslip for</span>
            {selectionMode === 'multiple' ? (
              <select
                value={selectedReference}
                onChange={(event) => requestOrganisationChange(event.target.value)}
                disabled={profileLoading}
              >
                {profiles.map((item) => {
                  const reference = profileReference(item);
                  return (
                    <option value={reference} key={reference}>
                      {profileName(item)}
                    </option>
                  );
                })}
              </select>
            ) : (
              <strong>{profileName(selectedProfileSummary)}</strong>
            )}
            <small>
              {safeText(profile.address, 'No organisation address configured')}
            </small>
          </div>
        </div>

        <div className="pd-context-meta">
          <div>
            <span>Logo</span>
            <strong>{logoSourceLabel(profile.logo_source)}</strong>
          </div>
          <div>
            <span>Active design</span>
            <strong>
              {hasCustomActiveDesign
                ? `${safeText(profile.active_design?.name, 'Custom design')} · ${formatVersion(activeVersion)}`
                : 'Classic Payroll · System default'}
            </strong>
          </div>
          <div>
            <span>Draft</span>
            <strong>{hasDraft ? formatVersion(draftVersion) : 'Not saved yet'}</strong>
          </div>
        </div>
      </section>

      <section className="pd-rule-note">
        <LockKeyhole size={17} />
        <div>
          <strong>Payroll values are locked to the payroll engine.</strong>
          <span>
            HR can change layout, labels and visibility only. Earnings, deductions,
            attendance, Professional Tax and Net Pay cannot be edited here.
          </span>
        </div>
      </section>

      <main className="pd-workspace">
        <aside className="pd-editor-shell">
          <nav className="pd-tabs" aria-label="Payslip designer sections">
            {EDITOR_TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  type="button"
                  key={tab.key}
                  className={activeTab === tab.key ? 'is-active' : ''}
                  onClick={() => setActiveTab(tab.key)}
                >
                  <Icon size={16} />
                  <span>{tab.label}</span>
                  <ChevronRight size={14} />
                </button>
              );
            })}
          </nav>

          <div className="pd-editor-panel">
            {profileLoading ? (
              <div className="pd-panel-loading">
                <Loader2 className="pd-spin" size={22} /> Loading organisation…
              </div>
            ) : null}

            {activeTab === 'document' ? (
              <div className="pd-editor-section">
                <div className="pd-section-heading">
                  <Palette size={18} />
                  <div>
                    <h2>Document & Theme</h2>
                    <p>Paper setup, typography and the main visual palette.</p>
                  </div>
                </div>

                <div className="pd-form-grid">
                  <Field label="Design name" wide>
                    <input
                      type="text"
                      value={safeText(design.name)}
                      maxLength={80}
                      onChange={(event) => updateDesign('name', event.target.value)}
                    />
                  </Field>
                  <Field label="Paper size">
                    <select
                      value={design.paper?.size || 'Letter'}
                      onChange={(event) => updateDesign('paper.size', event.target.value)}
                    >
                      {(catalog.page_sizes || ['Letter', 'A4']).map((item) => (
                        <option value={item} key={item}>{item}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Orientation">
                    <select
                      value={design.paper?.orientation || 'portrait'}
                      onChange={(event) => updateDesign('paper.orientation', event.target.value)}
                    >
                      {(catalog.orientations || ['portrait', 'landscape']).map((item) => (
                        <option value={item} key={item}>{item[0].toUpperCase() + item.slice(1)}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Page margin" hint={`${design.paper?.margin_mm || 14} mm`}>
                    <input
                      type="range"
                      min="6"
                      max="25"
                      value={Number(design.paper?.margin_mm || 14)}
                      onChange={(event) => updateDesign('paper.margin_mm', Number(event.target.value))}
                    />
                  </Field>
                  <Field label="Font family">
                    <select
                      value={design.theme?.font_family || 'Arial'}
                      onChange={(event) => updateDesign('theme.font_family', event.target.value)}
                    >
                      {(catalog.font_families || ['Arial']).map((item) => (
                        <option value={item} key={item}>{item}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Base font size" hint={`${design.theme?.base_font_size || 10}px`}>
                    <input
                      type="range"
                      min="8"
                      max="14"
                      value={Number(design.theme?.base_font_size || 10)}
                      onChange={(event) => updateDesign('theme.base_font_size', Number(event.target.value))}
                    />
                  </Field>
                  <ColorField
                    label="Primary text"
                    value={design.theme?.primary_color}
                    onChange={(value) => updateDesign('theme.primary_color', value)}
                  />
                  <ColorField
                    label="Accent"
                    value={design.theme?.accent_color}
                    onChange={(value) => updateDesign('theme.accent_color', value)}
                  />
                  <ColorField
                    label="Border"
                    value={design.theme?.border_color}
                    onChange={(value) => updateDesign('theme.border_color', value)}
                  />
                  <ColorField
                    label="Muted text"
                    value={design.theme?.muted_color}
                    onChange={(value) => updateDesign('theme.muted_color', value)}
                  />
                  <ColorField
                    label="Table header"
                    value={design.theme?.table_header_background}
                    onChange={(value) => updateDesign('theme.table_header_background', value)}
                  />
                  <ColorField
                    label="Net pay background"
                    value={design.theme?.net_background}
                    onChange={(value) => updateDesign('theme.net_background', value)}
                  />
                </div>

                <div className="pd-reset-box">
                  <div>
                    <strong>Need to start over?</strong>
                    <span>Reset only the editable draft. Already generated payslips remain unchanged.</span>
                  </div>
                  <div>
                    <button
                      type="button"
                      className="pd-btn subtle"
                      onClick={() => setResetMode('active')}
                    >
                      <RotateCcw size={15} /> Reset to Active
                    </button>
                    <button
                      type="button"
                      className="pd-btn subtle"
                      onClick={() => setResetMode('system_default')}
                    >
                      <RefreshCw size={15} /> System Default
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {activeTab === 'header' ? (
              <div className="pd-editor-section">
                <div className="pd-section-heading">
                  <Image size={18} />
                  <div>
                    <h2>Header & Organisation</h2>
                    <p>Control how the organisation identity appears at the top.</p>
                  </div>
                </div>

                <Toggle
                  checked={design.header?.show_logo !== false}
                  onChange={(value) => updateDesign('header.show_logo', value)}
                  label="Show payroll logo"
                  description={`Uses ${logoSourceLabel(profile.logo_source).toLowerCase()}.`}
                />
                <Toggle
                  checked={design.header?.show_organisation_name !== false}
                  onChange={(value) => updateDesign('header.show_organisation_name', value)}
                  label="Show organisation name"
                />
                <Toggle
                  checked={design.header?.show_address !== false}
                  onChange={(value) => updateDesign('header.show_address', value)}
                  label="Show organisation address"
                />
                <Toggle
                  checked={Boolean(design.header?.show_contact)}
                  onChange={(value) => updateDesign('header.show_contact', value)}
                  label="Show email / phone / website"
                />

                <div className="pd-form-grid pd-gap-top">
                  <Field label="Payslip title" wide>
                    <input
                      type="text"
                      value={safeText(design.header?.title_text)}
                      maxLength={80}
                      onChange={(event) => updateDesign('header.title_text', event.target.value)}
                    />
                  </Field>
                  <Field label="Header alignment">
                    <select
                      value={design.header?.alignment || 'center'}
                      onChange={(event) => updateDesign('header.alignment', event.target.value)}
                    >
                      {(catalog.alignments || ['left', 'center', 'right']).map((item) => (
                        <option value={item} key={item}>{item[0].toUpperCase() + item.slice(1)}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Logo position">
                    <select
                      value={design.header?.logo_position || 'left'}
                      onChange={(event) => updateDesign('header.logo_position', event.target.value)}
                      disabled={design.header?.show_logo === false}
                    >
                      {(catalog.logo_positions || ['left', 'center', 'right']).map((item) => (
                        <option value={item} key={item}>{item[0].toUpperCase() + item.slice(1)}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Logo width" hint={`${design.header?.logo_width_px || 76}px`}>
                    <input
                      type="range"
                      min="40"
                      max="140"
                      value={Number(design.header?.logo_width_px || 76)}
                      disabled={design.header?.show_logo === false}
                      onChange={(event) => updateDesign('header.logo_width_px', Number(event.target.value))}
                    />
                  </Field>
                  <Field label="Logo height" hint={`${design.header?.logo_height_px || 56}px`}>
                    <input
                      type="range"
                      min="32"
                      max="100"
                      value={Number(design.header?.logo_height_px || 56)}
                      disabled={design.header?.show_logo === false}
                      onChange={(event) => updateDesign('header.logo_height_px', Number(event.target.value))}
                    />
                  </Field>
                </div>

                <div className="pd-branding-callout">
                  <Building2 size={18} />
                  <div>
                    <strong>{profileName(profile)}</strong>
                    <span>
                      Logo and organisation details are managed under System Settings → Payroll Branding.
                    </span>
                  </div>
                  <button type="button" className="pd-btn subtle" onClick={goBack}>
                    Open Settings
                  </button>
                </div>
              </div>
            ) : null}

            {activeTab === 'employee' ? (
              <div className="pd-editor-section">
                <div className="pd-section-heading">
                  <Type size={18} />
                  <div>
                    <h2>Employee Information</h2>
                    <p>Choose the payroll/employee fields shown and rename display labels.</p>
                  </div>
                </div>

                <Toggle
                  checked={design.employee_info?.visible !== false}
                  onChange={(value) => updateDesign('employee_info.visible', value)}
                  label="Show employee information section"
                />
                <Toggle
                  checked={design.employee_info?.show_empty_values !== false}
                  onChange={(value) => updateDesign('employee_info.show_empty_values', value)}
                  label="Show fields with empty values"
                />

                <div className="pd-field-list">
                  {employeeCatalog
                    .slice()
                    .sort((left, right) => {
                      const leftIndex = visibleIndex.has(left.key)
                        ? visibleIndex.get(left.key)
                        : 999;
                      const rightIndex = visibleIndex.has(right.key)
                        ? visibleIndex.get(right.key)
                        : 999;
                      return leftIndex - rightIndex;
                    })
                    .map((field) => {
                      const isVisible = visibleIndex.has(field.key);
                      const index = visibleIndex.get(field.key);
                      const customLabel = design.employee_info?.labels?.[field.key] || '';
                      return (
                        <div className={`pd-field-item ${isVisible ? 'is-visible' : ''}`} key={field.key}>
                          <button
                            type="button"
                            className={`pd-check ${isVisible ? 'is-checked' : ''}`}
                            onClick={() => toggleEmployeeField(field.key, !isVisible)}
                            aria-label={`${isVisible ? 'Hide' : 'Show'} ${field.label}`}
                          >
                            {isVisible ? <Check size={14} /> : null}
                          </button>
                          <div className="pd-field-item-copy">
                            <strong>{field.label}</strong>
                            <span>{field.source === 'attendance' ? 'Attendance / payroll source' : 'Employee master source'}</span>
                          </div>
                          <input
                            type="text"
                            placeholder="Display label"
                            value={customLabel}
                            maxLength={80}
                            disabled={!isVisible}
                            onChange={(event) => updateEmployeeLabel(field.key, event.target.value)}
                          />
                          <div className="pd-order-buttons">
                            <button
                              type="button"
                              disabled={!isVisible || index === 0}
                              onClick={() => moveEmployeeField(field.key, -1)}
                              aria-label={`Move ${field.label} up`}
                            >
                              <ArrowUp size={14} />
                            </button>
                            <button
                              type="button"
                              disabled={!isVisible || index === visibleEmployeeFields.length - 1}
                              onClick={() => moveEmployeeField(field.key, 1)}
                              aria-label={`Move ${field.label} down`}
                            >
                              <ArrowDown size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            ) : null}

            {activeTab === 'payroll' ? (
              <div className="pd-editor-section">
                <div className="pd-section-heading">
                  <SlidersHorizontal size={18} />
                  <div>
                    <h2>Payroll Tables</h2>
                    <p>Rename table headings and control optional rows. Amounts stay read-only.</p>
                  </div>
                </div>

                <Toggle
                  checked={design.earnings_deductions?.visible !== false}
                  onChange={(value) => updateDesign('earnings_deductions.visible', value)}
                  label="Show earnings & deductions"
                />
                <Toggle
                  checked={design.earnings_deductions?.show_zero_values !== false}
                  onChange={(value) => updateDesign('earnings_deductions.show_zero_values', value)}
                  label="Show components with zero value"
                />
                <Toggle
                  checked={design.earnings_deductions?.show_employer_contributions !== false}
                  onChange={(value) => updateDesign('earnings_deductions.show_employer_contributions', value)}
                  label="Show employer contributions"
                  description="For example, employer PF/ESIC where payroll provides them."
                />

                <div className="pd-form-grid pd-gap-top">
                  <Field label="Earnings heading">
                    <input
                      type="text"
                      value={safeText(design.earnings_deductions?.earnings_title)}
                      maxLength={50}
                      onChange={(event) => updateDesign('earnings_deductions.earnings_title', event.target.value)}
                    />
                  </Field>
                  <Field label="Deductions heading">
                    <input
                      type="text"
                      value={safeText(design.earnings_deductions?.deductions_title)}
                      maxLength={50}
                      onChange={(event) => updateDesign('earnings_deductions.deductions_title', event.target.value)}
                    />
                  </Field>
                  <Field label="Gross salary label">
                    <input
                      type="text"
                      value={safeText(design.earnings_deductions?.gross_title)}
                      maxLength={50}
                      onChange={(event) => updateDesign('earnings_deductions.gross_title', event.target.value)}
                    />
                  </Field>
                  <Field label="Amount heading">
                    <input
                      type="text"
                      value={safeText(design.earnings_deductions?.amount_title)}
                      maxLength={50}
                      onChange={(event) => updateDesign('earnings_deductions.amount_title', event.target.value)}
                    />
                  </Field>
                  <Field label="Cost to Company label">
                    <input
                      type="text"
                      value={safeText(design.earnings_deductions?.cost_to_company_label)}
                      maxLength={60}
                      onChange={(event) => updateDesign('earnings_deductions.cost_to_company_label', event.target.value)}
                    />
                  </Field>
                  <Field label="Total deductions label">
                    <input
                      type="text"
                      value={safeText(design.earnings_deductions?.total_deductions_label)}
                      maxLength={60}
                      onChange={(event) => updateDesign('earnings_deductions.total_deductions_label', event.target.value)}
                    />
                  </Field>
                  <Field label="Net pay label" wide>
                    <input
                      type="text"
                      value={safeText(design.earnings_deductions?.net_amount_label)}
                      maxLength={60}
                      onChange={(event) => updateDesign('earnings_deductions.net_amount_label', event.target.value)}
                    />
                  </Field>
                </div>

                <div className="pd-locked-values">
                  <LockKeyhole size={17} />
                  <div>
                    <strong>Calculated values cannot be edited</strong>
                    <span>Basic, HRA, Professional Tax, PF, ESIC, TDS, custom components and Net Pay are supplied by the payroll run.</span>
                  </div>
                </div>
              </div>
            ) : null}

            {activeTab === 'sections' ? (
              <div className="pd-editor-section">
                <div className="pd-section-heading">
                  <LayoutTemplate size={18} />
                  <div>
                    <h2>Section Order</h2>
                    <p>Move sections up/down and hide optional sections.</p>
                  </div>
                </div>

                <div className="pd-section-list">
                  {sectionOrder.map((sectionKey, index) => {
                    const item = sectionByKey[sectionKey] || {
                      key: sectionKey,
                      label: sectionKey,
                    };
                    const visible = sectionVisible(design, sectionKey);
                    return (
                      <div className={`pd-section-row ${visible ? '' : 'is-hidden'}`} key={sectionKey}>
                        <div className="pd-section-position">{index + 1}</div>
                        <div className="pd-section-copy">
                          <strong>{item.label}</strong>
                          <span>{visible ? 'Included in payslip' : 'Hidden from payslip'}</span>
                        </div>
                        <button
                          type="button"
                          className={`pd-visibility-btn ${visible ? 'is-visible' : ''}`}
                          onClick={() => setSectionVisibility(sectionKey, !visible)}
                        >
                          {visible ? <Eye size={15} /> : <EyeOff size={15} />}
                          {visible ? 'Visible' : 'Hidden'}
                        </button>
                        <div className="pd-order-buttons">
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() => moveSection(sectionKey, -1)}
                            aria-label={`Move ${item.label} up`}
                          >
                            <ArrowUp size={14} />
                          </button>
                          <button
                            type="button"
                            disabled={index === sectionOrder.length - 1}
                            onClick={() => moveSection(sectionKey, 1)}
                            aria-label={`Move ${item.label} down`}
                          >
                            <ArrowDown size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="pd-subsection-card">
                  <h3>Advance details</h3>
                  <Field label="Section title">
                    <input
                      type="text"
                      value={safeText(design.advances?.title)}
                      maxLength={60}
                      onChange={(event) => updateDesign('advances.title', event.target.value)}
                    />
                  </Field>
                </div>

                <div className="pd-subsection-card">
                  <h3>Payment / transfer details</h3>
                  <Toggle
                    checked={design.transfer?.show_amount_words !== false}
                    onChange={(value) => updateDesign('transfer.show_amount_words', value)}
                    label="Show Net Pay in words"
                  />
                  <Toggle
                    checked={design.transfer?.show_transfer_date !== false}
                    onChange={(value) => updateDesign('transfer.show_transfer_date', value)}
                    label="Show transfer date"
                  />
                  <Toggle
                    checked={design.transfer?.show_transfer_mode !== false}
                    onChange={(value) => updateDesign('transfer.show_transfer_mode', value)}
                    label="Show transfer mode"
                  />
                </div>
              </div>
            ) : null}

            {activeTab === 'footer' ? (
              <div className="pd-editor-section">
                <div className="pd-section-heading">
                  <FileCheck2 size={18} />
                  <div>
                    <h2>Footer & Signatory</h2>
                    <p>Set the standard note and optional authorized-signatory area.</p>
                  </div>
                </div>

                <Toggle
                  checked={design.footer?.visible !== false}
                  onChange={(value) => updateDesign('footer.visible', value)}
                  label="Show footer section"
                />
                <Toggle
                  checked={Boolean(design.footer?.show_authorized_signatory)}
                  onChange={(value) => updateDesign('footer.show_authorized_signatory', value)}
                  label="Show authorized signatory"
                />

                <div className="pd-form-grid pd-gap-top">
                  <Field label="Footer text" wide>
                    <textarea
                      rows="4"
                      value={safeText(design.footer?.text)}
                      maxLength={300}
                      onChange={(event) => updateDesign('footer.text', event.target.value)}
                    />
                  </Field>
                  <Field label="Signatory label" wide>
                    <input
                      type="text"
                      value={safeText(design.footer?.authorized_signatory_label)}
                      maxLength={80}
                      disabled={!design.footer?.show_authorized_signatory}
                      onChange={(event) => updateDesign('footer.authorized_signatory_label', event.target.value)}
                    />
                  </Field>
                </div>

                <div className="pd-footer-tip">
                  <FileCheck2 size={18} />
                  <div>
                    <strong>Default legal note is retained unless HR changes it.</strong>
                    <span>The payslip remains generated from the locked payroll record and its organization/design snapshot.</span>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </aside>

        <section className="pd-preview-shell">
          <div className="pd-preview-toolbar">
            <div>
              <span className="pd-preview-dot" />
              <strong>Live Payslip Preview</strong>
              <small>
                {previewSource === 'unsaved'
                  ? 'Unsaved design preview'
                  : previewSource === 'draft'
                    ? 'Saved draft preview'
                    : previewSource === 'active'
                      ? 'Active design preview'
                      : 'System default preview'}
              </small>
            </div>
            <label className="pd-auto-preview">
              <input
                type="checkbox"
                checked={autoPreview}
                onChange={(event) => setAutoPreview(event.target.checked)}
              />
              Auto refresh
            </label>
          </div>

          <div className="pd-preview-stage">
            {previewLoading && !previewHtml ? (
              <div className="pd-preview-empty">
                <Loader2 size={28} className="pd-spin" />
                <strong>Generating exact preview…</strong>
                <span>The backend renderer is preparing sample payroll data.</span>
              </div>
            ) : previewError ? (
              <div className="pd-preview-empty error">
                <AlertTriangle size={28} />
                <strong>Preview unavailable</strong>
                <span>{previewError}</span>
                <button
                  type="button"
                  className="pd-btn secondary"
                  onClick={() => requestPreview(design, selectedReference)}
                >
                  <RefreshCw size={15} /> Try Again
                </button>
              </div>
            ) : previewHtml ? (
              <div className="pd-preview-paper-wrap">
                {previewLoading ? (
                  <div className="pd-preview-updating">
                    <Loader2 size={14} className="pd-spin" /> Updating preview…
                  </div>
                ) : null}
                <iframe
                  title={`Payslip preview for ${profileName(profile)}`}
                  srcDoc={previewHtml}
                  className="pd-preview-frame"
                  sandbox=""
                />
              </div>
            ) : (
              <div className="pd-preview-empty">
                <Eye size={30} />
                <strong>No preview yet</strong>
                <span>Refresh the preview to render the current design.</span>
              </div>
            )}
          </div>
        </section>
      </main>

      <ConfirmationModal
        open={Boolean(pendingOrganisation)}
        title="Switch organisation without saving?"
        description="This organisation has unsaved payslip design changes. Switching now will discard those unsaved edits."
        confirmLabel="Discard & Switch"
        confirmTone="danger"
        onClose={() => setPendingOrganisation('')}
        onConfirm={() => switchOrganisation(pendingOrganisation)}
      />

      <ConfirmationModal
        open={Boolean(resetMode)}
        title={resetMode === 'system_default' ? 'Reset to system default?' : 'Reset to active design?'}
        description={
          resetMode === 'system_default'
            ? 'The editable draft will be replaced with the Classic Payroll system design. The active design and existing payslips will not change until you activate the new draft.'
            : 'The editable draft will be replaced with the current active design. Unsaved draft changes will be discarded.'
        }
        confirmLabel={resetMode === 'system_default' ? 'Reset to Default' : 'Reset Draft'}
        busy={resetting}
        onClose={() => !resetting && setResetMode('')}
        onConfirm={confirmReset}
      />
    </div>
  );
}

const designerStyles = `
  .pd-page {
    min-height: 100%;
    background: #f6f8f6;
    color: #17251d;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    padding: 22px;
  }

  .pd-page * { box-sizing: border-box; }
  .pd-page button, .pd-page input, .pd-page select, .pd-page textarea { font: inherit; }
  .pd-page button { -webkit-tap-highlight-color: transparent; }

  .pd-topbar {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 18px;
    max-width: 1640px;
    margin: 0 auto 16px;
  }

  .pd-title-wrap { display: flex; align-items: flex-start; gap: 12px; min-width: 0; }
  .pd-icon-btn {
    width: 40px;
    height: 40px;
    flex: 0 0 auto;
    border-radius: 12px;
    border: 1px solid #dbe5de;
    background: #fff;
    color: #31483a;
    display: inline-grid;
    place-items: center;
    cursor: pointer;
    transition: 0.16s ease;
  }
  .pd-icon-btn:hover { border-color: #a9c3b0; background: #f9fbf9; transform: translateY(-1px); }

  .pd-kicker {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 1px 0 4px;
    color: #397e51;
    text-transform: uppercase;
    letter-spacing: .08em;
    font-size: 11px;
    font-weight: 800;
  }
  .pd-title-wrap h1 { margin: 0; font-size: clamp(24px, 2.3vw, 34px); letter-spacing: -.04em; line-height: 1.05; font-weight: 900; }
  .pd-title-wrap p { margin: 7px 0 0; color: #6e7f74; font-size: 13px; }

  .pd-top-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
  .pd-save-state {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    border-radius: 999px;
    background: #edf7f0;
    color: #2d7045;
    font-size: 11px;
    font-weight: 800;
    white-space: nowrap;
  }
  .pd-save-state.is-dirty { background: #fff6dd; color: #8a6412; }
  .pd-save-state.is-dirty span { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }

  .pd-btn {
    min-height: 38px;
    border-radius: 11px;
    padding: 0 13px;
    border: 1px solid transparent;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    font-size: 12px;
    font-weight: 800;
    cursor: pointer;
    transition: 0.16s ease;
    white-space: nowrap;
  }
  .pd-btn:disabled { opacity: .55; cursor: not-allowed; transform: none !important; }
  .pd-btn.primary { background: #2b7346; color: #fff; border-color: #2b7346; box-shadow: 0 7px 16px rgba(43,115,70,.14); }
  .pd-btn.primary:hover:not(:disabled) { background: #23663d; transform: translateY(-1px); }
  .pd-btn.secondary { background: #fff; color: #31483a; border-color: #d8e3db; }
  .pd-btn.secondary:hover:not(:disabled), .pd-btn.subtle:hover:not(:disabled) { border-color: #a9c3b0; background: #f8fbf9; }
  .pd-btn.subtle { min-height: 34px; background: #fff; color: #486052; border-color: #dfe7e2; padding: 0 10px; }
  .pd-btn.danger { background: #a93c3c; color: #fff; border-color: #a93c3c; }
  .pd-btn.danger:hover:not(:disabled) { background: #913232; }

  .pd-banner {
    max-width: 1640px;
    margin: 0 auto 12px;
    min-height: 42px;
    padding: 9px 12px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    gap: 9px;
    font-size: 12px;
    font-weight: 700;
    border: 1px solid;
  }
  .pd-banner.success { background: #eef8f1; color: #286842; border-color: #cbe6d3; }
  .pd-banner.error { background: #fff1f0; color: #8e3430; border-color: #f0cbc8; }
  .pd-banner span { flex: 1; }
  .pd-banner button { border: 0; background: transparent; color: inherit; display: grid; place-items: center; cursor: pointer; }

  .pd-context-card {
    max-width: 1640px;
    margin: 0 auto 12px;
    background: #fff;
    border: 1px solid #dfe7e2;
    border-radius: 17px;
    padding: 14px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    box-shadow: 0 8px 24px rgba(31,68,44,.04);
  }
  .pd-context-main { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .pd-org-mark {
    width: 48px;
    height: 48px;
    border-radius: 12px;
    border: 1px solid #e1e8e3;
    background: #f8faf8;
    display: grid;
    place-items: center;
    overflow: hidden;
    flex: 0 0 auto;
    color: #397e51;
    font-weight: 900;
    font-size: 13px;
  }
  .pd-org-mark img { width: 100%; height: 100%; object-fit: contain; padding: 4px; }
  .pd-org-copy { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .pd-org-copy > span { color: #7b8a81; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; font-weight: 800; }
  .pd-org-copy strong { font-size: 14px; font-weight: 900; overflow-wrap: anywhere; }
  .pd-org-copy small { color: #78877e; font-size: 11px; max-width: 520px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pd-org-copy select {
    min-width: 260px;
    max-width: 520px;
    border: 1px solid #d9e3dc;
    border-radius: 9px;
    min-height: 34px;
    padding: 0 30px 0 9px;
    background: #fff;
    color: #17251d;
    font-weight: 850;
    outline: none;
  }
  .pd-org-copy select:focus { border-color: #75a887; box-shadow: 0 0 0 3px rgba(57,126,81,.09); }

  .pd-context-meta { display: flex; align-items: stretch; gap: 0; border: 1px solid #e5ebe7; border-radius: 11px; overflow: hidden; }
  .pd-context-meta > div { min-width: 138px; padding: 9px 12px; display: flex; flex-direction: column; gap: 2px; border-left: 1px solid #e5ebe7; }
  .pd-context-meta > div:first-child { border-left: 0; }
  .pd-context-meta span { color: #859188; text-transform: uppercase; letter-spacing: .05em; font-size: 9px; font-weight: 800; }
  .pd-context-meta strong { color: #34493b; font-size: 11px; font-weight: 850; }

  .pd-rule-note {
    max-width: 1640px;
    margin: 0 auto 14px;
    padding: 10px 13px;
    border: 1px solid #d5e7da;
    background: #f3faf5;
    border-radius: 12px;
    display: flex;
    align-items: center;
    gap: 10px;
    color: #326c46;
  }
  .pd-rule-note > div { display: flex; flex-wrap: wrap; gap: 4px 9px; }
  .pd-rule-note strong { font-size: 11px; }
  .pd-rule-note span { font-size: 11px; color: #5c7765; }

  .pd-workspace {
    max-width: 1640px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: minmax(540px, 0.9fr) minmax(500px, 1.1fr);
    gap: 14px;
    align-items: start;
  }

  .pd-editor-shell, .pd-preview-shell {
    background: #fff;
    border: 1px solid #dfe7e2;
    border-radius: 17px;
    box-shadow: 0 10px 30px rgba(31,68,44,.045);
    overflow: hidden;
  }
  .pd-editor-shell { display: grid; grid-template-columns: 170px minmax(0,1fr); min-height: 720px; }
  .pd-tabs { background: #f7f9f7; border-right: 1px solid #e4ebe6; padding: 10px; display: flex; flex-direction: column; gap: 4px; }
  .pd-tabs button {
    width: 100%;
    border: 1px solid transparent;
    background: transparent;
    color: #607066;
    min-height: 42px;
    border-radius: 10px;
    padding: 0 9px;
    display: grid;
    grid-template-columns: 18px 1fr 14px;
    align-items: center;
    gap: 7px;
    text-align: left;
    font-size: 11px;
    font-weight: 800;
    cursor: pointer;
  }
  .pd-tabs button:hover { background: #fff; border-color: #e3eae5; }
  .pd-tabs button.is-active { background: #edf6ef; border-color: #d3e6d8; color: #2b7346; }

  .pd-editor-panel { min-width: 0; position: relative; }
  .pd-panel-loading { position: absolute; inset: 0; z-index: 5; background: rgba(255,255,255,.78); display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 12px; font-weight: 800; }
  .pd-editor-section { padding: 18px; }
  .pd-section-heading { display: flex; align-items: flex-start; gap: 9px; padding-bottom: 14px; border-bottom: 1px solid #e8ede9; margin-bottom: 14px; color: #397e51; }
  .pd-section-heading h2 { margin: 0; color: #17251d; font-size: 16px; letter-spacing: -.02em; font-weight: 900; }
  .pd-section-heading p { margin: 3px 0 0; color: #7a8980; font-size: 11px; line-height: 1.5; }

  .pd-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 11px; }
  .pd-gap-top { margin-top: 14px; }
  .pd-field { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
  .pd-field.is-wide { grid-column: 1 / -1; }
  .pd-field-label { font-size: 10px; color: #56685c; font-weight: 850; }
  .pd-field-hint { color: #809087; font-size: 9px; }
  .pd-field input[type="text"], .pd-field select, .pd-field textarea {
    width: 100%;
    border: 1px solid #dbe4de;
    border-radius: 9px;
    background: #fff;
    color: #25382c;
    padding: 9px 10px;
    outline: none;
    font-size: 11px;
    transition: .15s ease;
  }
  .pd-field input[type="text"], .pd-field select { min-height: 36px; }
  .pd-field textarea { resize: vertical; min-height: 90px; line-height: 1.5; }
  .pd-field input:focus, .pd-field select:focus, .pd-field textarea:focus { border-color: #79a98a; box-shadow: 0 0 0 3px rgba(57,126,81,.08); }
  .pd-field input:disabled, .pd-field select:disabled, .pd-field textarea:disabled { background: #f4f6f4; color: #9ba69f; }
  .pd-field input[type="range"] { width: 100%; accent-color: #397e51; }

  .pd-color-input { display: grid; grid-template-columns: 40px 1fr; gap: 7px; }
  .pd-color-input input[type="color"] { width: 40px; height: 36px; border: 1px solid #dbe4de; border-radius: 9px; background: #fff; padding: 3px; cursor: pointer; }
  .pd-color-input input[type="text"] { min-width: 0; }

  .pd-toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 10px 0;
    border-bottom: 1px solid #edf0ed;
    cursor: default;
  }
  .pd-toggle-row > span { display: flex; flex-direction: column; gap: 2px; }
  .pd-toggle-row strong { font-size: 11px; color: #34493b; }
  .pd-toggle-row small { font-size: 9px; color: #849087; line-height: 1.4; }
  .pd-switch { width: 38px; height: 22px; flex: 0 0 auto; border: 0; background: #ccd5cf; border-radius: 999px; padding: 3px; cursor: pointer; transition: .16s ease; }
  .pd-switch span { display: block; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.18); transition: .16s ease; }
  .pd-switch.is-on { background: #397e51; }
  .pd-switch.is-on span { transform: translateX(16px); }

  .pd-reset-box, .pd-branding-callout, .pd-locked-values, .pd-footer-tip {
    margin-top: 16px;
    border: 1px solid #e0e8e2;
    background: #f9fbf9;
    border-radius: 12px;
    padding: 11px;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .pd-reset-box { justify-content: space-between; }
  .pd-reset-box > div:first-child, .pd-branding-callout > div, .pd-locked-values > div, .pd-footer-tip > div { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
  .pd-reset-box strong, .pd-branding-callout strong, .pd-locked-values strong, .pd-footer-tip strong { font-size: 11px; }
  .pd-reset-box span, .pd-branding-callout span, .pd-locked-values span, .pd-footer-tip span { color: #7a8980; font-size: 9px; line-height: 1.45; }
  .pd-reset-box > div:last-child { display: flex; gap: 6px; }
  .pd-branding-callout, .pd-footer-tip { color: #397e51; }
  .pd-locked-values { background: #f3faf5; border-color: #d6e8db; color: #397e51; }

  .pd-field-list { margin-top: 14px; display: flex; flex-direction: column; gap: 6px; }
  .pd-field-item { border: 1px solid #e6ece8; border-radius: 10px; padding: 8px; display: grid; grid-template-columns: 25px minmax(110px,1fr) minmax(125px,.9fr) 54px; align-items: center; gap: 7px; background: #fafbfa; opacity: .72; }
  .pd-field-item.is-visible { background: #fff; opacity: 1; border-color: #dce7df; }
  .pd-check { width: 23px; height: 23px; border-radius: 6px; border: 1px solid #cbd7cf; background: #fff; color: #fff; display: grid; place-items: center; cursor: pointer; }
  .pd-check.is-checked { background: #397e51; border-color: #397e51; }
  .pd-field-item-copy { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .pd-field-item-copy strong { font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pd-field-item-copy span { font-size: 8px; color: #8b968f; }
  .pd-field-item > input { min-width: 0; width: 100%; min-height: 31px; border: 1px solid #dbe4de; border-radius: 7px; padding: 0 8px; font-size: 9px; outline: none; }
  .pd-field-item > input:focus { border-color: #79a98a; }
  .pd-field-item > input:disabled { background: #f2f4f2; }

  .pd-order-buttons { display: flex; gap: 3px; }
  .pd-order-buttons button { width: 25px; height: 25px; border: 1px solid #dce5df; border-radius: 6px; background: #fff; color: #55675b; display: grid; place-items: center; cursor: pointer; }
  .pd-order-buttons button:hover:not(:disabled) { border-color: #9ebaa7; color: #2b7346; }
  .pd-order-buttons button:disabled { opacity: .32; cursor: default; }

  .pd-section-list { display: flex; flex-direction: column; gap: 7px; }
  .pd-section-row { min-height: 50px; border: 1px solid #dfe7e2; border-radius: 10px; background: #fff; padding: 7px 8px; display: grid; grid-template-columns: 28px 1fr auto 54px; gap: 8px; align-items: center; }
  .pd-section-row.is-hidden { background: #f7f8f7; opacity: .7; }
  .pd-section-position { width: 25px; height: 25px; display: grid; place-items: center; border-radius: 7px; background: #edf5ef; color: #397e51; font-size: 9px; font-weight: 900; }
  .pd-section-copy { display: flex; flex-direction: column; gap: 1px; }
  .pd-section-copy strong { font-size: 10px; }
  .pd-section-copy span { font-size: 8px; color: #87948c; }
  .pd-visibility-btn { min-height: 28px; border: 1px solid #dce5df; border-radius: 7px; background: #fff; color: #7b8980; display: inline-flex; align-items: center; gap: 5px; padding: 0 8px; font-size: 9px; font-weight: 800; cursor: pointer; }
  .pd-visibility-btn.is-visible { color: #34764b; border-color: #cfe2d5; background: #f1f8f3; }
  .pd-subsection-card { margin-top: 13px; border-top: 1px solid #e8ede9; padding-top: 13px; }
  .pd-subsection-card h3 { margin: 0 0 7px; font-size: 11px; font-weight: 900; color: #34493b; }

  .pd-preview-shell { position: sticky; top: 12px; }
  .pd-preview-toolbar { min-height: 52px; border-bottom: 1px solid #e3eae5; padding: 9px 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px; background: #fafbfa; }
  .pd-preview-toolbar > div { display: grid; grid-template-columns: 8px auto; column-gap: 7px; align-items: center; }
  .pd-preview-dot { width: 7px; height: 7px; border-radius: 50%; background: #397e51; grid-row: 1 / 3; }
  .pd-preview-toolbar strong { font-size: 11px; }
  .pd-preview-toolbar small { color: #829087; font-size: 8px; }
  .pd-auto-preview { display: flex; align-items: center; gap: 6px; font-size: 9px; color: #65756b; font-weight: 800; cursor: pointer; }
  .pd-auto-preview input { accent-color: #397e51; }

  .pd-preview-stage { height: 760px; background: #e8ece9; padding: 18px; overflow: hidden; }
  .pd-preview-paper-wrap { width: 100%; height: 100%; position: relative; display: flex; justify-content: center; }
  .pd-preview-frame { width: min(100%, 780px); height: 100%; border: 0; background: #fff; box-shadow: 0 14px 34px rgba(31,50,38,.14); border-radius: 2px; }
  .pd-preview-updating { position: absolute; top: 9px; right: calc(50% - min(50%,390px) + 9px); z-index: 3; padding: 5px 8px; border-radius: 999px; background: rgba(23,37,29,.88); color: #fff; display: flex; align-items: center; gap: 5px; font-size: 8px; font-weight: 800; }
  .pd-preview-empty { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; text-align: center; color: #65766b; }
  .pd-preview-empty strong { color: #35483c; font-size: 12px; }
  .pd-preview-empty span { max-width: 360px; font-size: 10px; line-height: 1.5; }
  .pd-preview-empty.error { color: #a14842; }

  .pd-modal-backdrop { position: fixed; inset: 0; z-index: 1000; background: rgba(16,27,20,.48); backdrop-filter: blur(3px); display: grid; place-items: center; padding: 18px; }
  .pd-modal { width: min(100%, 430px); background: #fff; border-radius: 16px; border: 1px solid #dce4de; box-shadow: 0 24px 60px rgba(15,31,21,.22); padding: 18px; }
  .pd-modal-icon { width: 40px; height: 40px; border-radius: 11px; display: grid; place-items: center; background: #fff3df; color: #9a6b16; margin-bottom: 10px; }
  .pd-modal-copy h3 { margin: 0; font-size: 16px; font-weight: 900; letter-spacing: -.02em; }
  .pd-modal-copy p { margin: 6px 0 0; color: #718077; font-size: 11px; line-height: 1.55; }
  .pd-modal-actions { margin-top: 17px; display: flex; justify-content: flex-end; gap: 8px; }

  .pd-centered-state { display: grid; place-items: center; min-height: 70vh; }
  .pd-state-card { width: min(100%, 480px); background: #fff; border: 1px solid #dde6df; border-radius: 17px; padding: 26px; text-align: center; box-shadow: 0 12px 30px rgba(28,61,40,.06); display: flex; flex-direction: column; align-items: center; gap: 8px; color: #397e51; }
  .pd-state-card h2 { margin: 4px 0 0; color: #17251d; font-size: 18px; font-weight: 900; }
  .pd-state-card p { margin: 0 0 9px; color: #718077; font-size: 11px; line-height: 1.5; }
  .pd-state-card.error { color: #a14842; }
  .pd-state-actions { display: flex; gap: 7px; }
  .pd-loading-stack { display: flex; flex-direction: column; align-items: center; gap: 7px; color: #397e51; }
  .pd-loading-stack strong { color: #17251d; font-size: 13px; }
  .pd-loading-stack span { color: #7a8980; font-size: 10px; }

  .pd-spin { animation: pd-spin .8s linear infinite; }
  @keyframes pd-spin { to { transform: rotate(360deg); } }

  @media (max-width: 1260px) {
    .pd-workspace { grid-template-columns: 1fr; }
    .pd-preview-shell { position: static; }
    .pd-preview-stage { height: 700px; }
    .pd-context-card { align-items: flex-start; }
    .pd-context-meta { flex-wrap: wrap; }
    .pd-context-meta > div { min-width: 120px; }
  }

  @media (max-width: 860px) {
    .pd-page { padding: 14px; }
    .pd-topbar { flex-direction: column; }
    .pd-top-actions { width: 100%; justify-content: flex-start; }
    .pd-context-card { flex-direction: column; }
    .pd-context-meta { width: 100%; }
    .pd-context-meta > div { flex: 1; }
    .pd-editor-shell { grid-template-columns: 1fr; }
    .pd-tabs { border-right: 0; border-bottom: 1px solid #e4ebe6; flex-direction: row; overflow-x: auto; }
    .pd-tabs button { min-width: 132px; grid-template-columns: 18px 1fr; }
    .pd-tabs button svg:last-child { display: none; }
    .pd-preview-stage { height: 620px; padding: 10px; }
  }

  @media (max-width: 620px) {
    .pd-page { padding: 10px; }
    .pd-title-wrap p { display: none; }
    .pd-top-actions .pd-save-state { width: 100%; justify-content: center; }
    .pd-top-actions .pd-btn { flex: 1; }
    .pd-context-meta { display: grid; grid-template-columns: 1fr; }
    .pd-context-meta > div { border-left: 0; border-top: 1px solid #e5ebe7; }
    .pd-context-meta > div:first-child { border-top: 0; }
    .pd-org-copy select { min-width: 0; width: 100%; }
    .pd-form-grid { grid-template-columns: 1fr; }
    .pd-field.is-wide { grid-column: auto; }
    .pd-field-item { grid-template-columns: 25px 1fr 54px; }
    .pd-field-item > input { grid-column: 2 / 4; }
    .pd-section-row { grid-template-columns: 28px 1fr 54px; }
    .pd-visibility-btn { grid-column: 2 / 3; justify-self: start; }
    .pd-reset-box, .pd-branding-callout { align-items: flex-start; flex-direction: column; }
    .pd-reset-box > div:last-child { width: 100%; }
    .pd-reset-box .pd-btn { flex: 1; }
    .pd-preview-stage { height: 530px; }
  }
`;
