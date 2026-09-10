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
    --pd-ink: #15152f;
    --pd-ink-2: #282443;
    --pd-purple: #6558d9;
    --pd-purple-deep: #30275f;
    --pd-purple-soft: #eeeaff;
    --pd-cream: #f5f0e8;
    --pd-paper: #fffdf8;
    --pd-lime: #dfff5f;
    --pd-cobalt: #3156d8;
    --pd-sky: #bfe7ff;
    --pd-coral: #ff715b;
    --pd-pink: #f4a7cf;
    --pd-lilac: #c9b7ff;
    --pd-mint: #7fd0ae;
    --pd-yellow: #ffd95f;
    --pd-border: rgba(21, 21, 47, 0.14);
    --pd-border-strong: rgba(21, 21, 47, 0.22);
    --pd-shadow-sm: 0 12px 30px rgba(21, 21, 47, 0.08);
    --pd-shadow-md: 0 20px 52px rgba(21, 21, 47, 0.12);
    --pd-shadow-lg: 0 34px 90px rgba(21, 21, 47, 0.18);
    min-height: 100%;
    width: 100%;
    color: var(--pd-ink);
    background:
      radial-gradient(circle at 8% 3%, rgba(191, 231, 255, 0.58), transparent 24%),
      radial-gradient(circle at 92% 5%, rgba(201, 183, 255, 0.48), transparent 23%),
      linear-gradient(135deg, #f9fbff 0%, #fffdf8 46%, #f7f2ff 100%);
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    padding: clamp(12px, 1.8vw, 26px);
    position: relative;
    overflow-x: clip;
  }

  .pd-page::before {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    opacity: .32;
    background-image:
      linear-gradient(rgba(48, 39, 95, .028) 1px, transparent 1px),
      linear-gradient(90deg, rgba(48, 39, 95, .028) 1px, transparent 1px);
    background-size: 46px 46px;
    z-index: 0;
  }

  .pd-page > * { position: relative; z-index: 1; }
  .pd-page * { box-sizing: border-box; }
  .pd-page button, .pd-page input, .pd-page select, .pd-page textarea { font: inherit; }
  .pd-page button { -webkit-tap-highlight-color: transparent; }
  .pd-page button:focus-visible,
  .pd-page input:focus-visible,
  .pd-page select:focus-visible,
  .pd-page textarea:focus-visible {
    outline: 3px solid rgba(101, 88, 217, .20);
    outline-offset: 2px;
  }

  .pd-topbar {
    max-width: 1640px;
    margin: 0 auto 14px;
    padding: clamp(14px, 1.35vw, 20px);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    border: 1px solid rgba(255, 255, 255, .76);
    border-radius: 24px;
    background: linear-gradient(120deg, rgba(255,255,255,.88), rgba(245,241,255,.80) 52%, rgba(230,247,255,.76));
    -webkit-backdrop-filter: blur(22px) saturate(145%);
    backdrop-filter: blur(22px) saturate(145%);
    box-shadow: var(--pd-shadow-sm), inset 0 1px 0 rgba(255,255,255,.9);
  }

  .pd-title-wrap { display: flex; align-items: center; gap: 14px; min-width: 0; }
  .pd-icon-btn {
    width: 44px;
    height: 44px;
    flex: 0 0 auto;
    border-radius: 14px;
    border: 1px solid rgba(48,39,95,.16);
    background: rgba(255,255,255,.82);
    color: var(--pd-purple-deep);
    display: inline-grid;
    place-items: center;
    cursor: pointer;
    box-shadow: 0 9px 20px rgba(48,39,95,.08);
    transition: transform .2s ease, border-color .2s ease, box-shadow .2s ease, background .2s ease;
  }
  .pd-icon-btn:hover { transform: translateY(-2px); border-color: rgba(101,88,217,.34); background: #fff; box-shadow: 0 12px 26px rgba(48,39,95,.13); }

  .pd-kicker {
    width: fit-content;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    margin: 0 0 6px;
    padding: 7px 10px;
    border: 1px solid rgba(101,88,217,.13);
    border-radius: 999px;
    color: var(--pd-purple-deep);
    background: var(--pd-purple-soft);
    text-transform: uppercase;
    letter-spacing: .11em;
    font-size: 11px;
    font-weight: 900;
  }
  .pd-title-wrap h1 { margin: 0; color: var(--pd-ink); font-size: clamp(25px, 2.2vw, 36px); letter-spacing: -.045em; line-height: 1; font-weight: 900; }
  .pd-title-wrap p { margin: 7px 0 0; color: #6f6b86; font-size: 14px; line-height: 1.5; }

  .pd-top-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
  .pd-save-state {
    min-height: 36px;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 0 11px;
    border: 1px solid rgba(127,208,174,.34);
    border-radius: 999px;
    background: rgba(227,245,232,.82);
    color: #2f765b;
    font-size: 12px;
    font-weight: 900;
    white-space: nowrap;
  }
  .pd-save-state.is-dirty { background: #fff6cf; color: #7e6010; border-color: rgba(255,217,95,.72); }
  .pd-save-state.is-dirty span { width: 7px; height: 7px; border-radius: 50%; background: currentColor; box-shadow: 0 0 0 4px rgba(126,96,16,.08); }

  .pd-btn {
    min-height: 40px;
    border-radius: 999px;
    padding: 0 14px;
    border: 1px solid transparent;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    font-size: 13px;
    font-weight: 850;
    cursor: pointer;
    transition: transform .2s ease, box-shadow .2s ease, border-color .2s ease, background .2s ease, color .2s ease;
    white-space: nowrap;
  }
  .pd-btn:disabled { opacity: .48; cursor: not-allowed; transform: none !important; box-shadow: none !important; }
  .pd-btn.primary { background: var(--pd-purple-deep); color: #fff; border-color: var(--pd-purple-deep); box-shadow: 0 12px 26px rgba(48,39,95,.22); }
  .pd-btn.primary:hover:not(:disabled) { color: var(--pd-ink); background: var(--pd-lime); border-color: var(--pd-lime); transform: translateY(-2px); box-shadow: 0 15px 30px rgba(21,21,47,.16); }
  .pd-btn.secondary { background: rgba(255,255,255,.82); color: var(--pd-ink); border-color: rgba(21,21,47,.15); }
  .pd-btn.secondary:hover:not(:disabled), .pd-btn.subtle:hover:not(:disabled) { border-color: rgba(101,88,217,.33); background: #fff; transform: translateY(-1px); }
  .pd-btn.subtle { min-height: 34px; background: rgba(255,255,255,.78); color: var(--pd-purple-deep); border-color: rgba(48,39,95,.14); padding: 0 11px; }
  .pd-btn.danger { background: #a74052; color: #fff; border-color: #a74052; }
  .pd-btn.danger:hover:not(:disabled) { background: #8d3444; transform: translateY(-1px); }

  .pd-banner {
    max-width: 1640px;
    margin: 0 auto 12px;
    min-height: 44px;
    padding: 10px 13px;
    border-radius: 15px;
    display: flex;
    align-items: center;
    gap: 9px;
    font-size: 13px;
    font-weight: 800;
    border: 1px solid;
    box-shadow: 0 10px 24px rgba(21,21,47,.05);
    animation: pd-slide-down .28s cubic-bezier(.22,1,.36,1) both;
  }
  .pd-banner.success { background: #edf9f2; color: #2b6c53; border-color: #c9eadb; }
  .pd-banner.error { background: #fff0f2; color: #8b3245; border-color: #f3c8d0; }
  .pd-banner span { flex: 1; }
  .pd-banner button { border: 0; background: transparent; color: inherit; display: grid; place-items: center; cursor: pointer; }

  .pd-context-card {
    max-width: 1640px;
    margin: 0 auto 12px;
    padding: clamp(13px, 1.3vw, 18px);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    border: 1px solid var(--pd-border);
    border-radius: 22px;
    background: rgba(255,253,248,.86);
    box-shadow: var(--pd-shadow-sm);
  }
  .pd-context-main { display: flex; align-items: center; gap: 13px; min-width: 0; }
  .pd-org-mark {
    width: 54px;
    height: 54px;
    border-radius: 16px;
    border: 1px solid rgba(101,88,217,.18);
    background: linear-gradient(145deg, #f7f3ff, #e6f7ff);
    display: grid;
    place-items: center;
    overflow: hidden;
    flex: 0 0 auto;
    color: var(--pd-purple-deep);
    font-weight: 950;
    font-size: 14px;
    box-shadow: 6px 7px 0 rgba(201,183,255,.55);
  }
  .pd-org-mark img { width: 100%; height: 100%; object-fit: contain; padding: 5px; }
  .pd-org-copy { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .pd-org-copy > span { color: #817d93; font-size: 11px; text-transform: uppercase; letter-spacing: .10em; font-weight: 900; }
  .pd-org-copy strong { font-size: 15px; font-weight: 900; overflow-wrap: anywhere; }
  .pd-org-copy small { color: #7d788f; font-size: 12px; max-width: 520px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pd-org-copy select {
    min-width: 270px;
    max-width: 520px;
    min-height: 37px;
    padding: 0 34px 0 11px;
    border: 1px solid rgba(21,21,47,.14);
    border-radius: 11px;
    background: #fff;
    color: var(--pd-ink);
    font-size: 13px;
    font-weight: 850;
    outline: none;
  }
  .pd-org-copy select:focus { border-color: rgba(101,88,217,.58); box-shadow: 0 0 0 4px rgba(101,88,217,.09); }

  .pd-context-meta { display: flex; align-items: stretch; gap: 7px; }
  .pd-context-meta > div {
    min-width: 138px;
    padding: 9px 11px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    border: 1px solid rgba(21,21,47,.10);
    border-radius: 12px;
    background: rgba(255,255,255,.72);
  }
  .pd-context-meta span { color: #8c879c; text-transform: uppercase; letter-spacing: .08em; font-size: 10px; font-weight: 900; }
  .pd-context-meta strong { color: var(--pd-ink-2); font-size: 12px; font-weight: 850; line-height: 1.35; }

  .pd-rule-note {
    max-width: 1640px;
    margin: 0 auto 14px;
    padding: 10px 13px;
    border: 1px solid rgba(49,86,216,.15);
    background: linear-gradient(90deg, rgba(223,244,255,.78), rgba(238,234,255,.72));
    border-radius: 14px;
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--pd-cobalt);
  }
  .pd-rule-note > div { display: flex; flex-wrap: wrap; gap: 4px 9px; }
  .pd-rule-note strong { color: var(--pd-ink); font-size: 12px; }
  .pd-rule-note span { font-size: 12px; color: #68647c; }

  .pd-workspace {
    max-width: 1640px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: minmax(560px, .94fr) minmax(520px, 1.06fr);
    gap: 16px;
    align-items: start;
  }

  .pd-editor-shell, .pd-preview-shell {
    border: 1px solid var(--pd-border);
    border-radius: 24px;
    background: rgba(255,253,248,.91);
    box-shadow: var(--pd-shadow-md);
    overflow: hidden;
  }
  .pd-editor-shell { display: grid; grid-template-columns: 188px minmax(0,1fr); min-height: 735px; }
  .pd-tabs {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    border-right: 1px solid rgba(21,21,47,.10);
    background: linear-gradient(180deg, rgba(238,234,255,.62), rgba(223,244,255,.45) 52%, rgba(255,253,248,.78));
  }
  .pd-tabs button {
    width: 100%;
    min-height: 46px;
    padding: 0 10px;
    border: 1px solid transparent;
    border-radius: 13px;
    background: transparent;
    color: #6c6880;
    display: grid;
    grid-template-columns: 18px 1fr 14px;
    align-items: center;
    gap: 8px;
    text-align: left;
    font-size: 12px;
    font-weight: 850;
    cursor: pointer;
    transition: transform .18s ease, background .18s ease, border-color .18s ease, color .18s ease, box-shadow .18s ease;
  }
  .pd-tabs button:hover { background: rgba(255,255,255,.76); border-color: rgba(101,88,217,.12); transform: translateX(2px); }
  .pd-tabs button.is-active { color: #fff; background: var(--pd-purple-deep); border-color: var(--pd-purple-deep); box-shadow: 0 12px 24px rgba(48,39,95,.18); }
  .pd-tabs button.is-active svg:last-child { transform: translateX(2px); }

  .pd-editor-panel { min-width: 0; position: relative; }
  .pd-panel-loading { position: absolute; inset: 0; z-index: 5; background: rgba(255,253,248,.82); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); display: grid; place-items: center; align-content: center; gap: 8px; color: var(--pd-purple-deep); font-size: 13px; font-weight: 850; }
  .pd-editor-section { padding: clamp(17px, 1.65vw, 24px); animation: pd-panel-in .28s cubic-bezier(.22,1,.36,1) both; }

  .pd-section-heading { display: flex; align-items: flex-start; gap: 11px; margin-bottom: 18px; }
  .pd-section-heading > svg {
    width: 38px; height: 38px; padding: 9px; flex: 0 0 auto;
    color: var(--pd-purple-deep);
    border: 1px solid rgba(101,88,217,.15);
    border-radius: 12px;
    background: var(--pd-purple-soft);
  }
  .pd-section-heading h2 { margin: 0; color: var(--pd-ink); font-size: clamp(17px, 1.35vw, 22px); line-height: 1.05; letter-spacing: -.035em; font-weight: 900; }
  .pd-section-heading p { margin: 5px 0 0; color: #7d788f; font-size: 12px; line-height: 1.45; }

  .pd-form-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 11px; }
  .pd-gap-top { margin-top: 14px; }
  .pd-field { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
  .pd-field.is-wide { grid-column: 1 / -1; }
  .pd-field-label { color: #56516b; font-size: 11px; font-weight: 900; letter-spacing: .045em; }
  .pd-field-hint { margin-top: -2px; color: #918ca0; font-size: 10px; }
  .pd-field input[type="text"], .pd-field select, .pd-field textarea {
    width: 100%;
    min-height: 44px;
    border: 1px solid rgba(21,21,47,.14);
    border-radius: 11px;
    background: rgba(255,255,255,.9);
    color: var(--pd-ink);
    padding: 0 11px;
    font-size: 12px;
    font-weight: 700;
    outline: none;
    transition: border-color .18s ease, box-shadow .18s ease, background .18s ease;
  }
  .pd-field textarea { min-height: 96px; resize: vertical; padding: 10px 11px; line-height: 1.5; }
  .pd-field input[type="text"]:focus, .pd-field select:focus, .pd-field textarea:focus { border-color: rgba(101,88,217,.55); box-shadow: 0 0 0 4px rgba(101,88,217,.08); background: #fff; }
  .pd-field input:disabled, .pd-field select:disabled, .pd-field textarea:disabled { background: #f2f0f5; color: #9a95a5; }
  .pd-field input[type="range"] { width: 100%; accent-color: var(--pd-purple); cursor: pointer; }

  .pd-color-input { display: grid; grid-template-columns: 42px minmax(0,1fr); gap: 7px; }
  .pd-color-input input[type="color"] { width: 42px; height: 39px; padding: 3px; border: 1px solid rgba(21,21,47,.14); border-radius: 10px; background: #fff; cursor: pointer; }
  .pd-color-input input[type="text"] { min-width: 0; }

  .pd-toggle-row {
    min-height: 54px;
    padding: 9px 10px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    border: 1px solid rgba(21,21,47,.10);
    border-radius: 12px;
    background: rgba(255,255,255,.68);
    margin-bottom: 7px;
    transition: border-color .18s ease, background .18s ease, transform .18s ease;
  }
  .pd-toggle-row:hover { border-color: rgba(101,88,217,.22); background: #fff; transform: translateY(-1px); }
  .pd-toggle-row.is-disabled { opacity: .55; }
  .pd-toggle-row > span { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .pd-toggle-row strong { color: var(--pd-ink-2); font-size: 12px; }
  .pd-toggle-row small { font-size: 10px; color: #8c8798; line-height: 1.4; }
  .pd-switch { width: 40px; height: 23px; flex: 0 0 auto; border: 0; background: #c9c5d0; border-radius: 999px; padding: 3px; cursor: pointer; transition: background .18s ease, box-shadow .18s ease; }
  .pd-switch span { display: block; width: 17px; height: 17px; border-radius: 50%; background: #fff; box-shadow: 0 2px 5px rgba(0,0,0,.18); transition: transform .2s cubic-bezier(.22,1,.36,1); }
  .pd-switch.is-on { background: var(--pd-purple); box-shadow: 0 0 0 4px rgba(101,88,217,.08); }
  .pd-switch.is-on span { transform: translateX(17px); }

  .pd-reset-box, .pd-branding-callout, .pd-locked-values, .pd-footer-tip {
    margin-top: 16px;
    border: 1px solid rgba(21,21,47,.10);
    border-radius: 14px;
    padding: 11px;
    display: flex;
    align-items: center;
    gap: 10px;
    background: linear-gradient(125deg, rgba(255,255,255,.82), rgba(238,234,255,.58));
  }
  .pd-reset-box {
    justify-content: space-between;
    flex-wrap: wrap;
  }
  .pd-reset-box > div:first-child {
    min-width: min(100%, 260px);
    flex: 1 1 300px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .pd-branding-callout > div, .pd-locked-values > div, .pd-footer-tip > div {
    min-width: 0;
    flex: 1 1 240px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .pd-reset-box strong, .pd-branding-callout strong, .pd-locked-values strong, .pd-footer-tip strong { color: var(--pd-ink); font-size: 12px; }
  .pd-reset-box span, .pd-branding-callout span, .pd-locked-values span, .pd-footer-tip span {
    color: #827d91;
    font-size: 10px;
    line-height: 1.55;
    white-space: normal;
    overflow-wrap: break-word;
    word-break: normal;
  }
  .pd-reset-box > div:last-child {
    flex: 0 1 auto;
    min-width: max-content;
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }
  .pd-reset-box > div:last-child .pd-btn { white-space: nowrap; }
  .pd-branding-callout, .pd-footer-tip { color: var(--pd-cobalt); }
  .pd-locked-values { background: linear-gradient(120deg, rgba(223,244,255,.70), rgba(238,234,255,.66)); color: var(--pd-cobalt); }

  .pd-field-list { margin-top: 14px; display: flex; flex-direction: column; gap: 7px; }
  .pd-field-item {
    padding: 8px;
    display: grid;
    grid-template-columns: 26px minmax(115px,1fr) minmax(130px,.95fr) 56px;
    align-items: center;
    gap: 8px;
    border: 1px solid rgba(21,21,47,.10);
    border-radius: 11px;
    background: #f7f5fa;
    opacity: .68;
    transition: transform .18s ease, border-color .18s ease, background .18s ease, opacity .18s ease, box-shadow .18s ease;
  }
  .pd-field-item.is-visible { background: rgba(255,255,255,.86); opacity: 1; border-color: rgba(101,88,217,.14); }
  .pd-field-item.is-visible:hover { transform: translateY(-1px); box-shadow: 0 9px 20px rgba(21,21,47,.06); }
  .pd-check { width: 24px; height: 24px; border-radius: 7px; border: 1px solid rgba(21,21,47,.18); background: #fff; color: #fff; display: grid; place-items: center; cursor: pointer; }
  .pd-check.is-checked { background: var(--pd-purple-deep); border-color: var(--pd-purple-deep); }
  .pd-field-item-copy { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .pd-field-item-copy strong { font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pd-field-item-copy span { font-size: 10px; color: #918b9c; }
  .pd-field-item > input { min-width: 0; width: 100%; min-height: 40px; border: 1px solid rgba(21,21,47,.12); border-radius: 8px; padding: 0 8px; font-size: 11px; outline: none; background: #fff; }
  .pd-field-item > input:focus { border-color: rgba(101,88,217,.48); box-shadow: 0 0 0 3px rgba(101,88,217,.07); }
  .pd-field-item > input:disabled { background: #efedf2; }

  .pd-order-buttons { display: flex; gap: 4px; }
  .pd-order-buttons button { width: 26px; height: 26px; border: 1px solid rgba(21,21,47,.12); border-radius: 7px; background: #fff; color: #625d73; display: grid; place-items: center; cursor: pointer; transition: .16s ease; }
  .pd-order-buttons button:hover:not(:disabled) { border-color: rgba(101,88,217,.35); color: var(--pd-purple-deep); background: var(--pd-purple-soft); transform: translateY(-1px); }
  .pd-order-buttons button:disabled { opacity: .28; cursor: default; }

  .pd-section-list { display: flex; flex-direction: column; gap: 7px; }
  .pd-section-row {
    min-height: 52px;
    padding: 7px 8px;
    display: grid;
    grid-template-columns: 30px 1fr auto 56px;
    gap: 8px;
    align-items: center;
    border: 1px solid rgba(21,21,47,.11);
    border-radius: 11px;
    background: rgba(255,255,255,.84);
    transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease;
  }
  .pd-section-row:hover { transform: translateY(-1px); border-color: rgba(101,88,217,.20); box-shadow: 0 8px 18px rgba(21,21,47,.05); }
  .pd-section-row.is-hidden { background: #f4f2f6; opacity: .64; }
  .pd-section-position { width: 27px; height: 27px; display: grid; place-items: center; border-radius: 8px; background: var(--pd-purple-soft); color: var(--pd-purple-deep); font-size: 11px; font-weight: 950; }
  .pd-section-copy { display: flex; flex-direction: column; gap: 1px; }
  .pd-section-copy strong { font-size: 11px; }
  .pd-section-copy span { font-size: 10px; color: #8d8799; }
  .pd-visibility-btn { min-height: 36px; border: 1px solid rgba(21,21,47,.12); border-radius: 8px; background: #fff; color: #777183; display: inline-flex; align-items: center; gap: 5px; padding: 0 8px; font-size: 11px; font-weight: 850; cursor: pointer; }
  .pd-visibility-btn.is-visible { color: #2f6d55; border-color: rgba(127,208,174,.42); background: #edf9f3; }
  .pd-subsection-card { margin-top: 14px; padding-top: 14px; border-top: 1px solid rgba(21,21,47,.09); }
  .pd-subsection-card h3 { margin: 0 0 8px; font-size: 13px; font-weight: 900; color: var(--pd-ink-2); }

  .pd-preview-shell { position: sticky; top: 12px; }
  .pd-preview-toolbar {
    min-height: 56px;
    padding: 10px 13px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    border-bottom: 1px solid rgba(21,21,47,.10);
    background: linear-gradient(100deg, rgba(238,234,255,.66), rgba(223,244,255,.62), rgba(255,253,248,.78));
  }
  .pd-preview-toolbar > div { display: grid; grid-template-columns: 9px auto; column-gap: 7px; align-items: center; }
  .pd-preview-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--pd-mint); grid-row: 1 / 3; box-shadow: 0 0 0 5px rgba(127,208,174,.15); animation: pd-pulse 2s ease-in-out infinite; }
  .pd-preview-toolbar strong { font-size: 13px; }
  .pd-preview-toolbar small { color: #878193; font-size: 10px; }
  .pd-auto-preview { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #6f697d; font-weight: 850; cursor: pointer; }
  .pd-auto-preview input { accent-color: var(--pd-purple); }

  .pd-preview-stage {
    height: clamp(650px, calc(100dvh - 260px), 820px);
    min-height: 560px;
    padding: clamp(12px, 1.4vw, 20px);
    overflow: hidden;
    background:
      radial-gradient(circle at 10% 10%, rgba(191,231,255,.42), transparent 28%),
      radial-gradient(circle at 90% 14%, rgba(201,183,255,.36), transparent 28%),
      #e8e8ee;
  }
  .pd-preview-paper-wrap { width: 100%; height: 100%; position: relative; display: flex; justify-content: center; }
  .pd-preview-frame { width: min(100%, 780px); height: 100%; border: 0; background: #fff; box-shadow: 0 22px 54px rgba(21,21,47,.18); border-radius: 4px; }
  .pd-preview-updating { position: absolute; top: 9px; right: calc(50% - min(50%,390px) + 9px); z-index: 3; padding: 6px 9px; border-radius: 999px; background: rgba(48,39,95,.92); color: #fff; display: flex; align-items: center; gap: 5px; font-size: 10px; font-weight: 850; box-shadow: 0 8px 18px rgba(48,39,95,.18); }
  .pd-preview-empty { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; text-align: center; color: #777184; }
  .pd-preview-empty > svg { width: 48px; height: 48px; padding: 12px; color: var(--pd-purple-deep); background: var(--pd-purple-soft); border-radius: 16px; }
  .pd-preview-empty strong { color: var(--pd-ink); font-size: 14px; }
  .pd-preview-empty span { max-width: 360px; font-size: 11px; line-height: 1.55; }
  .pd-preview-empty.error { color: #a1485a; }
  .pd-preview-empty.error > svg { color: #9a3e50; background: #fff0f3; }

  .pd-modal-backdrop { position: fixed; inset: 0; z-index: 1000; background: rgba(21,21,47,.48); -webkit-backdrop-filter: blur(7px); backdrop-filter: blur(7px); display: grid; place-items: center; padding: 18px; animation: pd-fade .18s ease both; }
  .pd-modal { width: min(100%, 440px); padding: 20px; border-radius: 22px; border: 1px solid rgba(255,255,255,.48); background: rgba(255,253,248,.96); box-shadow: var(--pd-shadow-lg); animation: pd-modal-in .26s cubic-bezier(.22,1,.36,1) both; }
  .pd-modal-icon { width: 42px; height: 42px; border-radius: 13px; display: grid; place-items: center; background: #fff1cf; color: #866516; margin-bottom: 11px; box-shadow: 5px 6px 0 rgba(255,217,95,.42); }
  .pd-modal-copy h3 { margin: 0; color: var(--pd-ink); font-size: 17px; font-weight: 900; letter-spacing: -.03em; }
  .pd-modal-copy p { margin: 7px 0 0; color: #787285; font-size: 12px; line-height: 1.6; }
  .pd-modal-actions { margin-top: 18px; display: flex; justify-content: flex-end; gap: 8px; }

  .pd-centered-state { display: grid; place-items: center; min-height: 72vh; }
  .pd-state-card { width: min(100%, 480px); padding: 28px; text-align: center; border: 1px solid var(--pd-border); border-radius: 24px; background: rgba(255,253,248,.92); box-shadow: var(--pd-shadow-md); display: flex; flex-direction: column; align-items: center; gap: 8px; color: var(--pd-purple-deep); }
  .pd-state-card > svg { width: 52px; height: 52px; padding: 13px; border-radius: 16px; background: var(--pd-purple-soft); }
  .pd-state-card h2 { margin: 4px 0 0; color: var(--pd-ink); font-size: 19px; font-weight: 900; letter-spacing: -.03em; }
  .pd-state-card p { margin: 0 0 9px; color: #777184; font-size: 12px; line-height: 1.55; }
  .pd-state-card.error { color: #a1485a; }
  .pd-state-card.error > svg { background: #fff0f3; }
  .pd-state-actions { display: flex; gap: 7px; }
  .pd-loading-stack { display: flex; flex-direction: column; align-items: center; gap: 7px; color: var(--pd-purple-deep); }
  .pd-loading-stack strong { color: var(--pd-ink); font-size: 14px; }
  .pd-loading-stack span { color: #817b8d; font-size: 12px; }

  .pd-spin { animation: pd-spin .8s linear infinite; }
  @keyframes pd-spin { to { transform: rotate(360deg); } }
  @keyframes pd-panel-in { from { opacity: 0; transform: translateY(7px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes pd-slide-down { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes pd-fade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes pd-modal-in { from { opacity: 0; transform: translateY(12px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
  @keyframes pd-pulse { 0%,100% { transform: scale(.94); box-shadow: 0 0 0 4px rgba(127,208,174,.10); } 50% { transform: scale(1.06); box-shadow: 0 0 0 7px rgba(127,208,174,.18); } }


  /* Responsive text safety: prevent flex/grid content from collapsing into letter-by-letter columns. */
  .pd-editor-panel, .pd-editor-section, .pd-form-grid, .pd-field, .pd-toggle-row > span,
  .pd-org-copy, .pd-section-copy, .pd-field-item-copy { min-width: 0; }
  .pd-editor-section p, .pd-editor-section span, .pd-editor-section strong,
  .pd-context-card span, .pd-context-card strong, .pd-rule-note span, .pd-rule-note strong {
    word-break: normal;
    overflow-wrap: break-word;
  }

  @media (max-width: 1380px) {
    .pd-workspace { grid-template-columns: minmax(500px, .92fr) minmax(470px, 1.08fr); }
    .pd-editor-shell { grid-template-columns: 174px minmax(0,1fr); }
    .pd-context-meta > div { min-width: 122px; }
  }

  @media (max-width: 1180px) {
    .pd-topbar { align-items: flex-start; }
    .pd-workspace { grid-template-columns: 1fr; }
    .pd-preview-shell { position: static; }
    .pd-preview-stage { height: 720px; }
    .pd-context-card { align-items: flex-start; }
    .pd-context-meta { flex-wrap: wrap; justify-content: flex-end; }
    .pd-context-meta > div { min-width: 118px; }
  }

  @media (max-width: 920px) {
    .pd-page { padding: 12px; }
    .pd-topbar { flex-direction: column; align-items: stretch; border-radius: 20px; }
    .pd-top-actions { width: 100%; justify-content: flex-start; }
    .pd-context-card { flex-direction: column; border-radius: 20px; }
    .pd-context-main { width: 100%; }
    .pd-context-meta { width: 100%; justify-content: stretch; }
    .pd-context-meta > div { flex: 1 1 150px; }
    .pd-editor-shell { grid-template-columns: 1fr; min-height: auto; }
    .pd-tabs {
      border-right: 0;
      border-bottom: 1px solid rgba(21,21,47,.10);
      flex-direction: row;
      overflow-x: auto;
      overscroll-behavior-inline: contain;
      scrollbar-width: thin;
      scroll-snap-type: x proximity;
    }
    .pd-tabs button { min-width: 142px; grid-template-columns: 18px 1fr; scroll-snap-align: start; }
    .pd-tabs button svg:last-child { display: none; }
    .pd-preview-stage { height: 660px; }
  }

  @media (max-width: 700px) {
    .pd-title-wrap { align-items: flex-start; }
    .pd-title-wrap p { max-width: 520px; }
    .pd-top-actions .pd-save-state { width: 100%; justify-content: center; }
    .pd-top-actions .pd-btn { flex: 1 1 calc(50% - 8px); min-width: 145px; }
    .pd-context-main { align-items: flex-start; }
    .pd-org-copy { flex: 1; }
    .pd-org-copy select { min-width: 0; width: 100%; max-width: 100%; }
    .pd-context-meta { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); }
    .pd-context-meta > div:last-child { grid-column: 1 / -1; }
    .pd-rule-note { align-items: flex-start; }
    .pd-rule-note > div { flex-direction: column; gap: 3px; }
    .pd-form-grid { grid-template-columns: 1fr; }
    .pd-field.is-wide { grid-column: auto; }
    .pd-field-item { grid-template-columns: 26px 1fr 56px; }
    .pd-field-item > input { grid-column: 2 / 4; }
    .pd-section-row { grid-template-columns: 30px 1fr 56px; }
    .pd-visibility-btn { grid-column: 2 / 3; justify-self: start; }
    .pd-reset-box, .pd-branding-callout { align-items: stretch; flex-direction: column; }
    .pd-reset-box > div:first-child { width: 100%; min-width: 0; flex: 0 0 auto; }
    .pd-reset-box > div:last-child { width: 100%; min-width: 0; justify-content: stretch; }
    .pd-reset-box .pd-btn { flex: 1 1 180px; }
    .pd-preview-stage { height: 580px; padding: 10px; min-height: 500px; }
  }

  @media (max-width: 520px) {
    .pd-page { padding: 8px; }
    .pd-page::before { background-size: 34px 34px; }
    .pd-topbar { padding: 12px; border-radius: 18px; }
    .pd-title-wrap { gap: 10px; }
    .pd-icon-btn { width: 40px; height: 40px; border-radius: 12px; }
    .pd-kicker { padding: 6px 8px; font-size: 10px; }
    .pd-title-wrap h1 { font-size: 24px; }
    .pd-title-wrap p { display: none; }
    .pd-top-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
    .pd-top-actions .pd-save-state { grid-column: 1 / -1; }
    .pd-top-actions .pd-btn { min-width: 0; width: 100%; padding-inline: 10px; }
    .pd-context-card { padding: 12px; }
    .pd-org-mark { width: 48px; height: 48px; border-radius: 14px; box-shadow: 4px 5px 0 rgba(201,183,255,.5); }
    .pd-org-copy small { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .pd-context-meta { grid-template-columns: 1fr; }
    .pd-context-meta > div:last-child { grid-column: auto; }
    .pd-rule-note { padding: 10px 11px; }
    .pd-editor-shell, .pd-preview-shell { border-radius: 18px; }
    .pd-tabs { padding: 8px; }
    .pd-tabs button { min-width: 132px; min-height: 42px; }
    .pd-editor-section { padding: 14px 12px 16px; }
    .pd-section-heading { margin-bottom: 14px; }
    .pd-section-heading > svg { width: 36px; height: 36px; }
    .pd-toggle-row { padding: 9px; }
    .pd-reset-box > div:first-child { min-width: 0; width: 100%; }
    .pd-reset-box > div:last-child { flex-direction: column; align-items: stretch; }
    .pd-reset-box .pd-btn { width: 100%; flex: 0 0 auto; }
    .pd-branding-callout .pd-btn { width: 100%; }
    .pd-field-item { grid-template-columns: 26px minmax(0,1fr) 56px; }
    .pd-field-item-copy span { white-space: normal; }
    .pd-section-row { align-items: start; }
    .pd-preview-toolbar { align-items: flex-start; }
    .pd-auto-preview { margin-top: 2px; }
    .pd-preview-stage { height: 520px; min-height: 460px; padding: 7px; }
    .pd-preview-updating { right: 8px; }
    .pd-modal { padding: 17px; border-radius: 18px; }
    .pd-modal-actions { display: grid; grid-template-columns: 1fr 1fr; }
    .pd-modal-actions .pd-btn { width: 100%; }
  }

  @media (max-width: 380px) {
    .pd-top-actions { grid-template-columns: 1fr; }
    .pd-top-actions .pd-save-state { grid-column: auto; }
    .pd-context-main { gap: 10px; }
    .pd-org-mark { width: 44px; height: 44px; }
    .pd-tabs button { min-width: 122px; padding-inline: 8px; }
    .pd-section-row { grid-template-columns: 28px minmax(0,1fr) 54px; }
    .pd-preview-stage { height: 470px; min-height: 430px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .pd-page *, .pd-page *::before, .pd-page *::after {
      scroll-behavior: auto !important;
      animation-duration: .01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: .01ms !important;
    }
  }
`;
