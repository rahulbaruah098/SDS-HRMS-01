import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Building2,
  Clock,
  Globe2,
  CheckCircle2,
  ImagePlus,
  LoaderCircle,
  Lock,
  LogIn,
  LogOut,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Type,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';

import { api, normalizeProfilePhotoUrl } from '../api/client';
import { normalizeRoleList } from '../data/modules';

const SETTINGS_POPUP_AUTO_HIDE_MS = 3600;
const MAX_LOGO_BYTES = 3 * 1024 * 1024;
const MAX_PLATFORM_LOGO_BYTES = 3 * 1024 * 1024;
const DEFAULT_PLATFORM_TAGLINE = 'People, Process and Performance';
const MAX_PLATFORM_TAGLINE_LENGTH = 160;
const MAX_ATTENDANCE_REASON_OPTIONS = 25;
const OTHER_REASON_CODE = 'other';
const DEFAULT_ATTENDANCE_SCHEDULE = Object.freeze({
  check_in_time: '09:30',
  late_cutoff_time: '09:50',
  break_start_time: '13:00',
  break_end_time: '14:00',
  check_out_time: '18:00',
});
const ATTENDANCE_REASON_MANAGER_ROLES = new Set([
  'super_admin',
  'admin',
  'hr_admin',
  'hr_manager',
  'hr',
]);
const PAYROLL_BRANDING_MANAGER_ROLES = new Set([
  'super_admin',
  'admin',
  'hr_admin',
  'hr_manager',
  'hr',
]);
const DEFAULT_LATE_REASON_OPTIONS = [
  { code: 'traffic_congestion', label: 'Traffic congestion' },
  { code: 'public_transport_delay', label: 'Public transport delay' },
  { code: 'vehicle_breakdown', label: 'Vehicle breakdown' },
  { code: 'bad_weather', label: 'Bad weather or heavy rain' },
  { code: 'medical_issue', label: 'Medical or health issue' },
  { code: 'family_emergency', label: 'Family emergency' },
  { code: 'official_duty', label: 'Official work or field duty' },
];
const DEFAULT_EARLY_CHECKOUT_REASON_OPTIONS = [
  { code: 'medical_appointment', label: 'Medical appointment' },
  { code: 'health_issue', label: 'Health issue' },
  { code: 'family_emergency', label: 'Family emergency' },
  { code: 'personal_emergency', label: 'Personal emergency' },
  { code: 'official_duty', label: 'Official work or field visit' },
  { code: 'transport_issue', label: 'Transport issue' },
  { code: 'manager_approval', label: 'Approved by manager or HR' },
];
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

function getPayrollProfileReference(profile = {}) {
  return safeText(
    profile.organisation_id ||
      profile.organization_id ||
      profile.organisation_code ||
      profile.organization_code ||
      profile.profile_key,
    'tenant',
  );
}

function getPayrollLogoSourceLabel(source = '') {
  const normalized = safeText(source).toLowerCase();

  if (normalized === 'payroll_branding') return 'Custom payroll logo';
  if (normalized === 'organisation' || normalized === 'organization') {
    return 'Organisation logo fallback';
  }
  if (normalized === 'tenant') return 'Company logo fallback';
  return 'Initials fallback';
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

function copyAttendanceReasons(options = []) {
  return options.map((option) => ({
    code: safeText(option?.code).toLowerCase(),
    label: safeText(option?.label),
  }));
}

function editableAttendanceReasons(values, fallbackOptions) {
  if (!Array.isArray(values)) {
    return copyAttendanceReasons(fallbackOptions);
  }

  const editable = values
    .map((item) => ({
      code: safeText(item?.code).toLowerCase(),
      label: safeText(item?.label),
    }))
    .filter(
      (item) => item.label && item.code !== OTHER_REASON_CODE,
    );

  return editable.length
    ? editable
    : copyAttendanceReasons(fallbackOptions);
}

function validateAttendanceReasonOptions(values, fieldLabel) {
  if (!Array.isArray(values) || !values.length) {
    return {
      error: `Add at least one ${fieldLabel.toLowerCase()}.`,
      values: [],
    };
  }

  if (values.length > MAX_ATTENDANCE_REASON_OPTIONS) {
    return {
      error:
        `A maximum of ${MAX_ATTENDANCE_REASON_OPTIONS} ` +
        `${fieldLabel.toLowerCase()} can be saved.`,
      values: [],
    };
  }

  const normalized = [];
  const usedLabels = new Set();

  for (let index = 0; index < values.length; index += 1) {
    const item = values[index] || {};
    const label = safeText(item.label).replace(/\s+/g, ' ');

    if (!label) {
      return {
        error: `${fieldLabel} item ${index + 1} cannot be blank.`,
        values: [],
      };
    }

    if (label.length < 3 || label.length > 80) {
      return {
        error:
          `${fieldLabel} item ${index + 1} must contain between ` +
          '3 and 80 characters.',
        values: [],
      };
    }

    const letters = label.match(/\p{L}/gu) || [];

    if (letters.length < 2) {
      return {
        error: `${fieldLabel} item ${index + 1} must contain a readable reason.`,
        values: [],
      };
    }

    const normalizedLabel = label.toLocaleLowerCase();

    if (normalizedLabel === OTHER_REASON_CODE) {
      return {
        error: 'Other is added automatically and must not be added manually.',
        values: [],
      };
    }

    if (usedLabels.has(normalizedLabel)) {
      return {
        error: `Duplicate ${fieldLabel.toLowerCase()} are not allowed.`,
        values: [],
      };
    }

    usedLabels.add(normalizedLabel);
    normalized.push({
      code: safeText(item.code).toLowerCase(),
      label,
    });
  }

  return { error: '', values: normalized };
}

function normalizeAttendanceTime(value, fallback = '') {
  const normalized = safeText(value);

  if (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(normalized)) {
    return normalized;
  }

  return fallback;
}

function getAttendanceScheduleFromResponse(data = {}) {
  const schedule =
    data.attendance_schedule ||
    data.schedule ||
    data.settings ||
    data;

  return {
    check_in_time: normalizeAttendanceTime(
      schedule?.check_in_time || schedule?.office_start,
      DEFAULT_ATTENDANCE_SCHEDULE.check_in_time,
    ),
    late_cutoff_time: normalizeAttendanceTime(
      schedule?.late_cutoff_time || schedule?.late_cutoff,
      DEFAULT_ATTENDANCE_SCHEDULE.late_cutoff_time,
    ),
    break_start_time: normalizeAttendanceTime(
      schedule?.break_start_time || schedule?.break_start,
      DEFAULT_ATTENDANCE_SCHEDULE.break_start_time,
    ),
    break_end_time: normalizeAttendanceTime(
      schedule?.break_end_time || schedule?.break_end,
      DEFAULT_ATTENDANCE_SCHEDULE.break_end_time,
    ),
    check_out_time: normalizeAttendanceTime(
      schedule?.check_out_time || schedule?.office_end,
      DEFAULT_ATTENDANCE_SCHEDULE.check_out_time,
    ),
  };
}

function attendanceTimeToMinutes(value) {
  const normalized = normalizeAttendanceTime(value);

  if (!normalized) {
    return null;
  }

  const [hours, minutes] = normalized.split(':').map(Number);
  return (hours * 60) + minutes;
}

function formatAttendanceTime(value) {
  const normalized = normalizeAttendanceTime(value);

  if (!normalized) {
    return '--';
  }

  const [hours, minutes] = normalized.split(':').map(Number);
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 || 12;

  return `${String(displayHour).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

function validateAttendanceSchedule(schedule = {}) {
  const normalized = getAttendanceScheduleFromResponse(schedule);
  const fields = [
    ['check_in_time', 'Check-in time'],
    ['late_cutoff_time', 'Late check-in cutoff'],
    ['break_start_time', 'Break start time'],
    ['break_end_time', 'Break end time'],
    ['check_out_time', 'Checkout time'],
  ];

  for (const [key, label] of fields) {
    if (!normalizeAttendanceTime(schedule?.[key])) {
      return { error: `${label} is required.`, values: normalized };
    }
  }

  const checkIn = attendanceTimeToMinutes(normalized.check_in_time);
  const lateCutoff = attendanceTimeToMinutes(normalized.late_cutoff_time);
  const breakStart = attendanceTimeToMinutes(normalized.break_start_time);
  const breakEnd = attendanceTimeToMinutes(normalized.break_end_time);
  const checkOut = attendanceTimeToMinutes(normalized.check_out_time);

  if (checkOut <= checkIn) {
    return {
      error: 'Checkout time must be later than check-in time.',
      values: normalized,
    };
  }

  if (lateCutoff < checkIn || lateCutoff >= checkOut) {
    return {
      error: 'Late check-in cutoff must be at or after check-in and before checkout.',
      values: normalized,
    };
  }

  if (breakStart <= checkIn || breakStart >= checkOut) {
    return {
      error: 'Break start must be after check-in and before checkout.',
      values: normalized,
    };
  }

  if (breakEnd <= breakStart || breakEnd >= checkOut) {
    return {
      error: 'Break end must be after break start and before checkout.',
      values: normalized,
    };
  }

  return { error: '', values: normalized };
}

function formatSettingsTimestamp(value) {
  if (!value) {
    return '';
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return '';
  }

  return parsed.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}


function SettingsInlineMessage({
  message,
  type = 'info',
  onClose,
  title = '',
}) {
  if (!message) {
    return null;
  }

  return (
    <div className={`settings-inline-message ${type}`} role="status">
      <span className="settings-inline-message-icon">
        {type === 'success' ? (
          <CheckCircle2 size={16} />
        ) : type === 'error' || type === 'warning' ? (
          <AlertTriangle size={16} />
        ) : (
          <ShieldCheck size={16} />
        )}
      </span>

      <span className="settings-inline-message-copy">
        {title ? <strong>{title}</strong> : null}
        <span>{message}</span>
      </span>

      {typeof onClose === 'function' ? (
        <button
          type="button"
          className="settings-inline-message-close"
          onClick={onClose}
          aria-label="Dismiss message"
        >
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
}

function SettingsConfirmPopup({ popup, onResolve }) {
  if (!popup || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      className="settings-confirm-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !popup.busy) {
          onResolve(false);
        }
      }}
    >
      <section
        className={`settings-confirm-card ${popup.danger ? 'is-danger' : 'is-confirm'}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-confirm-title"
      >
        <header className="settings-confirm-header">
          <div className={`settings-confirm-icon ${popup.danger ? 'is-danger' : ''}`}>
            {popup.danger ? <AlertTriangle size={22} /> : <ShieldCheck size={22} />}
          </div>

          <div className="settings-confirm-title">
            <span>Settings</span>
            <h3 id="settings-confirm-title">{popup.title || 'Confirm action'}</h3>
          </div>

          <button
            type="button"
            className="settings-confirm-close"
            onClick={() => onResolve(false)}
            disabled={popup.busy}
            aria-label="Close confirmation"
          >
            <X size={17} />
          </button>
        </header>

        <div className="settings-confirm-body">
          <p>{popup.message}</p>
        </div>

        <footer className="settings-confirm-actions">
          <button
            type="button"
            className="settings-confirm-cancel"
            onClick={() => onResolve(false)}
            disabled={popup.busy}
          >
            Cancel
          </button>

          <button
            type="button"
            className={`settings-confirm-submit ${popup.danger ? 'is-danger' : ''}`}
            onClick={() => onResolve(true)}
            disabled={popup.busy}
          >
            {popup.confirmLabel || 'Confirm'}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function AttendanceReasonListEditor({
  title,
  description,
  icon: Icon,
  options,
  disabled,
  onAdd,
  onChange,
  onMove,
  onRemove,
}) {
  return (
    <section className="attendance-reason-list-card">
      <div className="attendance-reason-list-heading">
        <span className="attendance-reason-list-icon">
          <Icon size={20} />
        </span>
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </div>

      <div className="attendance-reason-list">
        {options.map((option, index) => (
          <div className="attendance-reason-edit-row" key={`${option.code}-${index}`}>
            <span className="attendance-reason-number">{index + 1}</span>
            <input
              type="text"
              value={option.label}
              onChange={(event) => onChange(index, event.target.value)}
              maxLength={80}
              placeholder="Enter a clear reason"
              disabled={disabled}
              aria-label={`${title} item ${index + 1}`}
            />
            <div className="attendance-reason-row-actions">
              <button
                type="button"
                onClick={() => onMove(index, index - 1)}
                disabled={disabled || index === 0}
                title="Move reason up"
                aria-label={`Move ${option.label || `item ${index + 1}`} up`}
              >
                <ArrowUp size={15} />
              </button>
              <button
                type="button"
                onClick={() => onMove(index, index + 1)}
                disabled={disabled || index === options.length - 1}
                title="Move reason down"
                aria-label={`Move ${option.label || `item ${index + 1}`} down`}
              >
                <ArrowDown size={15} />
              </button>
              <button
                type="button"
                className="attendance-reason-delete"
                onClick={() => onRemove(index)}
                disabled={disabled || options.length <= 1}
                title="Remove reason"
                aria-label={`Remove ${option.label || `item ${index + 1}`}`}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}

        <div className="attendance-reason-edit-row is-locked">
          <span className="attendance-reason-number">
            <Lock size={14} />
          </span>
          <input type="text" value="Other" disabled aria-label="Other reason" />
          <span className="attendance-reason-locked-label">Fixed</span>
        </div>
      </div>

      <div className="attendance-reason-list-footer">
        <span>{options.length} editable reasons + Other</span>
        <button
          type="button"
          onClick={onAdd}
          disabled={disabled || options.length >= MAX_ATTENDANCE_REASON_OPTIONS}
        >
          <Plus size={16} /> Add Reason
        </button>
      </div>
    </section>
  );
}

export default function Settings({ user, setPage }) {
  const fileInputRef = useRef(null);
  const previewUrlRef = useRef('');
  const platformFileInputRef = useRef(null);
  const platformPreviewUrlRef = useRef('');
  const payrollLogoInputRef = useRef(null);
  const payrollLogoPreviewUrlRef = useRef('');

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

  const [payrollProfiles, setPayrollProfiles] = useState([]);
  const [payrollSelectionMode, setPayrollSelectionMode] = useState('single');
  const [payrollOrganisationCount, setPayrollOrganisationCount] = useState(0);
  const [selectedPayrollProfileKey, setSelectedPayrollProfileKey] = useState('');
  const [selectedPayrollLogoFile, setSelectedPayrollLogoFile] = useState(null);
  const [localPayrollLogoPreview, setLocalPayrollLogoPreview] = useState('');
  const [payrollBrandingLoading, setPayrollBrandingLoading] = useState(true);
  const [payrollLogoSaving, setPayrollLogoSaving] = useState(false);
  const [payrollLogoRemoving, setPayrollLogoRemoving] = useState(false);
  const [payrollBrandingMessage, setPayrollBrandingMessage] = useState('');
  const [payrollBrandingError, setPayrollBrandingError] = useState('');

  const [confirmPopup, setConfirmPopup] = useState(null);
  const confirmResolverRef = useRef(null);

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

  const [lateReasons, setLateReasons] = useState(() =>
    copyAttendanceReasons(DEFAULT_LATE_REASON_OPTIONS),
  );
  const [earlyCheckoutReasons, setEarlyCheckoutReasons] = useState(() =>
    copyAttendanceReasons(DEFAULT_EARLY_CHECKOUT_REASON_OPTIONS),
  );
  const [canManageAttendanceReasons, setCanManageAttendanceReasons] =
    useState(false);
  const [attendanceReasonSource, setAttendanceReasonSource] = useState('default');
  const [attendanceReasonUpdatedAt, setAttendanceReasonUpdatedAt] = useState('');
  const [attendanceReasonUpdatedBy, setAttendanceReasonUpdatedBy] = useState('');
  const [attendanceReasonsLoading, setAttendanceReasonsLoading] = useState(true);
  const [attendanceReasonsSaving, setAttendanceReasonsSaving] = useState(false);
  const [attendanceReasonMessage, setAttendanceReasonMessage] = useState('');
  const [attendanceReasonError, setAttendanceReasonError] = useState('');

  const [attendanceSchedule, setAttendanceSchedule] = useState(() => ({
    ...DEFAULT_ATTENDANCE_SCHEDULE,
  }));
  const [canManageAttendanceSchedule, setCanManageAttendanceSchedule] =
    useState(false);
  const [attendanceScheduleSource, setAttendanceScheduleSource] = useState('default');
  const [attendanceScheduleUpdatedAt, setAttendanceScheduleUpdatedAt] = useState('');
  const [attendanceScheduleUpdatedBy, setAttendanceScheduleUpdatedBy] = useState('');
  const [attendanceScheduleLoading, setAttendanceScheduleLoading] = useState(true);
  const [attendanceScheduleSaving, setAttendanceScheduleSaving] = useState(false);
  const [attendanceScheduleMessage, setAttendanceScheduleMessage] = useState('');
  const [attendanceScheduleError, setAttendanceScheduleError] = useState('');

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
  const hasAttendanceReasonManagerRole =
    isPlatformSuperadmin ||
    userRoles.some((role) => ATTENDANCE_REASON_MANAGER_ROLES.has(role));
  const canEditAttendanceReasons =
    canManageAttendanceReasons && hasAttendanceReasonManagerRole;
  const attendanceReasonsBusy =
    attendanceReasonsLoading || attendanceReasonsSaving;
  const canEditAttendanceSchedule =
    canManageAttendanceSchedule && hasAttendanceReasonManagerRole;
  const attendanceScheduleBusy =
    attendanceScheduleLoading || attendanceScheduleSaving;

  const hasPayrollBrandingManagerRole =
    isPlatformSuperadmin ||
    userRoles.some((role) => PAYROLL_BRANDING_MANAGER_ROLES.has(role));
  const selectedPayrollProfile = useMemo(() => {
    if (!payrollProfiles.length) return null;

    return (
      payrollProfiles.find(
        (profile) =>
          getPayrollProfileReference(profile) === selectedPayrollProfileKey,
      ) || payrollProfiles[0]
    );
  }, [payrollProfiles, selectedPayrollProfileKey]);
  const savedPayrollLogoUrl = useMemo(
    () =>
      normalizeProfilePhotoUrl(
        selectedPayrollProfile?.effective_logo_url ||
          selectedPayrollProfile?.payroll_logo_url ||
          '',
      ),
    [selectedPayrollProfile],
  );
  const previewPayrollLogoUrl = localPayrollLogoPreview || savedPayrollLogoUrl;
  const payrollBrandingBusy =
    payrollBrandingLoading || payrollLogoSaving || payrollLogoRemoving;

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

  function resolveConfirm(result) {
    const resolver = confirmResolverRef.current;
    confirmResolverRef.current = null;
    setConfirmPopup(null);

    if (resolver) {
      resolver(Boolean(result));
    }
  }

  function showConfirm(messageText, title, options = {}) {
    if (confirmResolverRef.current) {
      confirmResolverRef.current(false);
      confirmResolverRef.current = null;
    }

    return new Promise((resolve) => {
      confirmResolverRef.current = resolve;
      setConfirmPopup({
        title,
        message: messageText,
        danger: Boolean(options.danger),
        confirmLabel: options.confirmLabel || 'Confirm',
        busy: false,
      });
    });
  }

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

  function clearPayrollLogoLocalPreview() {
    if (payrollLogoPreviewUrlRef.current) {
      URL.revokeObjectURL(payrollLogoPreviewUrlRef.current);
      payrollLogoPreviewUrlRef.current = '';
    }

    setLocalPayrollLogoPreview('');
  }

  function resetSelectedPayrollLogoFile() {
    clearPayrollLogoLocalPreview();
    setSelectedPayrollLogoFile(null);

    if (payrollLogoInputRef.current) {
      payrollLogoInputRef.current.value = '';
    }
  }

  function replacePayrollProfile(nextProfile) {
    if (!nextProfile) return;

    const nextReference = getPayrollProfileReference(nextProfile);
    setPayrollProfiles((current) => {
      const index = current.findIndex(
        (profile) => getPayrollProfileReference(profile) === nextReference,
      );

      if (index < 0) return [...current, nextProfile];

      return current.map((profile, profileIndex) =>
        profileIndex === index ? nextProfile : profile,
      );
    });
    setSelectedPayrollProfileKey(nextReference);
  }

  async function loadPayrollBrandingProfiles({ silent = false } = {}) {
    if (!hasPayrollBrandingManagerRole) {
      setPayrollBrandingLoading(false);
      return;
    }

    if (!silent) {
      setPayrollBrandingLoading(true);
      setPayrollBrandingMessage('');
    }
    setPayrollBrandingError('');

    try {
      const data = await api('/payroll-branding/profiles');
      const profiles = Array.isArray(data?.profiles) ? data.profiles : [];

      setPayrollProfiles(profiles);
      setPayrollSelectionMode(
        safeText(data?.selection_mode, profiles.length <= 1 ? 'single' : 'multiple'),
      );
      setPayrollOrganisationCount(
        Number(data?.organisation_count ?? profiles.length) || profiles.length,
      );
      setSelectedPayrollProfileKey((current) => {
        const exists = profiles.some(
          (profile) => getPayrollProfileReference(profile) === current,
        );
        return exists ? current : getPayrollProfileReference(profiles[0] || {});
      });
      if (silent) {
        setPayrollBrandingMessage('Payroll branding refreshed successfully.');
      }
    } catch (requestError) {
      setPayrollProfiles([]);
      setPayrollSelectionMode('single');
      setPayrollOrganisationCount(0);
      setPayrollBrandingError(
        requestError?.message ||
          'Unable to load payroll branding. Please refresh and try again.',
      );
    } finally {
      setPayrollBrandingLoading(false);
    }
  }

  function handlePayrollProfileChange(event) {
    resetSelectedPayrollLogoFile();
    setSelectedPayrollProfileKey(event.target.value);
    setPayrollBrandingMessage('');
    setPayrollBrandingError('');
  }

  function handlePayrollLogoFileChange(event) {
    const file = event.target.files?.[0] || null;

    setPayrollBrandingMessage('');
    setPayrollBrandingError('');

    if (!file) {
      resetSelectedPayrollLogoFile();
      return;
    }

    if (!ALLOWED_LOGO_TYPES.has(String(file.type || '').toLowerCase())) {
      setPayrollBrandingError('Payroll logo must be JPG, JPEG, PNG, or WEBP.');
      resetSelectedPayrollLogoFile();
      return;
    }

    if (file.size > MAX_LOGO_BYTES) {
      setPayrollBrandingError('Payroll logo must be 3 MB or smaller.');
      resetSelectedPayrollLogoFile();
      return;
    }

    clearPayrollLogoLocalPreview();
    const previewUrl = URL.createObjectURL(file);
    payrollLogoPreviewUrlRef.current = previewUrl;
    setSelectedPayrollLogoFile(file);
    setLocalPayrollLogoPreview(previewUrl);
  }

  async function uploadPayrollLogo(event) {
    event.preventDefault();

    if (!selectedPayrollProfile) {
      setPayrollBrandingError('Select an organisation before uploading a payroll logo.');
      return;
    }

    if (!selectedPayrollLogoFile) {
      setPayrollBrandingError('Select a payroll logo before uploading.');
      return;
    }

    const reference = getPayrollProfileReference(selectedPayrollProfile);
    const formData = new FormData();
    formData.append('logo', selectedPayrollLogoFile);

    setPayrollLogoSaving(true);
    setPayrollBrandingMessage('');
    setPayrollBrandingError('');

    try {
      const data = await api(
        `/payroll-branding/profiles/${encodeURIComponent(reference)}/logo`,
        { method: 'POST', body: formData },
      );
      replacePayrollProfile(data?.profile);
      resetSelectedPayrollLogoFile();
      setPayrollBrandingMessage(
        data?.message || 'Payroll logo uploaded successfully.',
      );
    } catch (requestError) {
      setPayrollBrandingError(
        requestError?.message || 'Unable to upload the payroll logo. Please try again.',
      );
    } finally {
      setPayrollLogoSaving(false);
    }
  }

  async function removePayrollLogo() {
    if (!selectedPayrollProfile?.has_custom_payroll_logo) {
      return;
    }

    const organisationName = safeText(
      selectedPayrollProfile.organisation_name ||
        selectedPayrollProfile.organization_name,
      'This organisation',
    );

    const confirmed = await showConfirm(
      `${organisationName} will immediately fall back to its organisation/company logo or initials. Existing historical payroll snapshots remain protected.`,
      'Remove custom payroll logo?',
      {
        danger: true,
        confirmLabel: 'Remove Logo',
      },
    );

    if (!confirmed) {
      return;
    }

    const reference = getPayrollProfileReference(selectedPayrollProfile);
    setPayrollLogoRemoving(true);
    setPayrollBrandingMessage('');
    setPayrollBrandingError('');

    try {
      const data = await api(
        `/payroll-branding/profiles/${encodeURIComponent(reference)}/logo`,
        { method: 'DELETE' },
      );
      replacePayrollProfile(data?.profile);
      resetSelectedPayrollLogoFile();
      setPayrollBrandingMessage(
        data?.message || 'Custom payroll logo removed successfully.',
      );
    } catch (requestError) {
      setPayrollBrandingError(
        requestError?.message || 'Unable to remove the payroll logo. Please try again.',
      );
    } finally {
      setPayrollLogoRemoving(false);
    }
  }

  function openPayslipDesigner() {
    if (!selectedPayrollProfile) return;

    const reference = getPayrollProfileReference(selectedPayrollProfile);
    try {
      sessionStorage.setItem('sds_hrms_payslip_designer_organisation', reference);
    } catch (_error) {
      // Navigation still works when browser storage is unavailable.
    }

    if (typeof setPage === 'function') {
      setPage('payslip_designer');
      return;
    }

    setPayrollBrandingError('Payslip Designer navigation is unavailable.');
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
      if (silent) {
        setMessage('Company branding refreshed successfully.');
      }
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
      if (silent) {
        setPlatformMessage('YourComate branding refreshed successfully.');
      }
    } catch (requestError) {
      setPlatformError(
        requestError?.message ||
          'Unable to load YourComate branding. Please refresh and try again.',
      );
    } finally {
      setPlatformLoading(false);
    }
  }

  async function loadAttendanceReasonSettings({ silent = false } = {}) {
    if (!silent) {
      setAttendanceReasonsLoading(true);
      setAttendanceReasonMessage('');
    }

    setAttendanceReasonError('');

    try {
      const data = await api('/attendance/reason-settings');

      setLateReasons(
        editableAttendanceReasons(
          data?.late_reasons,
          DEFAULT_LATE_REASON_OPTIONS,
        ),
      );
      setEarlyCheckoutReasons(
        editableAttendanceReasons(
          data?.early_checkout_reasons,
          DEFAULT_EARLY_CHECKOUT_REASON_OPTIONS,
        ),
      );
      setCanManageAttendanceReasons(Boolean(data?.can_manage));
      setAttendanceReasonSource(safeText(data?.source, 'default'));
      setAttendanceReasonUpdatedAt(safeText(data?.updated_at));
      setAttendanceReasonUpdatedBy(safeText(data?.updated_by_name));
      if (silent) {
        setAttendanceReasonMessage('Attendance reasons refreshed successfully.');
      }
    } catch (requestError) {
      setCanManageAttendanceReasons(false);
      setAttendanceReasonError(
        requestError?.message ||
          'Unable to load attendance reasons. Please refresh and try again.',
      );
    } finally {
      setAttendanceReasonsLoading(false);
    }
  }

  async function loadAttendanceSchedule({ silent = false } = {}) {
    if (!silent) {
      setAttendanceScheduleLoading(true);
      setAttendanceScheduleMessage('');
    }

    setAttendanceScheduleError('');

    try {
      const data = await api('/attendance/schedule-settings');

      setAttendanceSchedule(getAttendanceScheduleFromResponse(data));
      setCanManageAttendanceSchedule(Boolean(data?.can_manage));
      setAttendanceScheduleSource(safeText(data?.source, 'default'));
      setAttendanceScheduleUpdatedAt(safeText(data?.updated_at));
      setAttendanceScheduleUpdatedBy(safeText(data?.updated_by_name));
      if (silent) {
        setAttendanceScheduleMessage('Attendance timings refreshed successfully.');
      }
    } catch (requestError) {
      setCanManageAttendanceSchedule(false);
      setAttendanceScheduleError(
        requestError?.message ||
          'Unable to load tenant attendance timings. Please refresh and try again.',
      );
    } finally {
      setAttendanceScheduleLoading(false);
    }
  }

  useEffect(() => {
    loadBranding();
    loadAttendanceSchedule();
    loadAttendanceReasonSettings();

    if (hasPayrollBrandingManagerRole) {
      loadPayrollBrandingProfiles();
    } else {
      setPayrollBrandingLoading(false);
      setPayrollProfiles([]);
    }

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

      if (payrollLogoPreviewUrlRef.current) {
        URL.revokeObjectURL(payrollLogoPreviewUrlRef.current);
      }
    };
  }, [isPlatformSuperadmin, hasPayrollBrandingManagerRole]);


  useEffect(() => {
    const timers = [];
    const scheduleDismiss = (value, setter) => {
      if (!value) {
        return;
      }

      timers.push(
        window.setTimeout(() => {
          setter('');
        }, SETTINGS_POPUP_AUTO_HIDE_MS),
      );
    };

    scheduleDismiss(message, setMessage);
    scheduleDismiss(error, setError);
    scheduleDismiss(platformMessage, setPlatformMessage);
    scheduleDismiss(platformError, setPlatformError);
    scheduleDismiss(payrollBrandingMessage, setPayrollBrandingMessage);
    scheduleDismiss(payrollBrandingError, setPayrollBrandingError);
    scheduleDismiss(attendanceReasonMessage, setAttendanceReasonMessage);
    scheduleDismiss(attendanceReasonError, setAttendanceReasonError);
    scheduleDismiss(attendanceScheduleMessage, setAttendanceScheduleMessage);
    scheduleDismiss(attendanceScheduleError, setAttendanceScheduleError);

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [
    message,
    error,
    platformMessage,
    platformError,
    payrollBrandingMessage,
    payrollBrandingError,
    attendanceReasonMessage,
    attendanceReasonError,
    attendanceScheduleMessage,
    attendanceScheduleError,
  ]);

  useEffect(() => {
    function dismissInlineMessages() {
      setMessage('');
      setError('');
      setPlatformMessage('');
      setPlatformError('');
      setPayrollBrandingMessage('');
      setPayrollBrandingError('');
      setAttendanceReasonMessage('');
      setAttendanceReasonError('');
      setAttendanceScheduleMessage('');
      setAttendanceScheduleError('');
    }

    document.addEventListener('pointerdown', dismissInlineMessages);
    return () => document.removeEventListener('pointerdown', dismissInlineMessages);
  }, []);

  useEffect(() => {
    if (!confirmPopup || typeof document === 'undefined') {
      return undefined;
    }

    const body = document.body;
    const root = document.documentElement;
    const previousBodyOverflow = body.style.overflow;
    const previousRootOverflow = root.style.overflow;
    const previousBodyOverscroll = body.style.overscrollBehavior;
    const previousRootOverscroll = root.style.overscrollBehavior;

    body.style.overflow = 'hidden';
    root.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
    root.style.overscrollBehavior = 'none';

    const blockBackgroundScroll = (event) => {
      const activePopup = document.querySelector('.settings-confirm-card');

      if (activePopup && activePopup.contains(event.target)) {
        return;
      }

      event.preventDefault();
    };

    const closeOnEscape = (event) => {
      if (event.key === 'Escape' && !confirmPopup.busy) {
        resolveConfirm(false);
      }
    };

    document.addEventListener('wheel', blockBackgroundScroll, { passive: false });
    document.addEventListener('touchmove', blockBackgroundScroll, { passive: false });
    window.addEventListener('keydown', closeOnEscape);

    return () => {
      document.removeEventListener('wheel', blockBackgroundScroll);
      document.removeEventListener('touchmove', blockBackgroundScroll);
      window.removeEventListener('keydown', closeOnEscape);

      body.style.overflow = previousBodyOverflow;
      root.style.overflow = previousRootOverflow;
      body.style.overscrollBehavior = previousBodyOverscroll;
      root.style.overscrollBehavior = previousRootOverscroll;
    };
  }, [confirmPopup]);

  function updateAttendanceScheduleField(name, value) {
    setAttendanceSchedule((current) => ({
      ...current,
      [name]: value,
    }));
    setAttendanceScheduleMessage('');
    setAttendanceScheduleError('');
  }

  function restoreDefaultAttendanceSchedule() {
    setAttendanceSchedule({ ...DEFAULT_ATTENDANCE_SCHEDULE });
    setAttendanceScheduleError('');
    setAttendanceScheduleMessage(
      'Default timings restored in the editor. Select Save Attendance Timings to apply them.',
    );
  }

  async function saveAttendanceSchedule(event) {
    event.preventDefault();

    if (!canEditAttendanceSchedule) {
      setAttendanceScheduleError(
        'Only tenant HR/Admin can change attendance timings.',
      );
      return;
    }

    const validation = validateAttendanceSchedule(attendanceSchedule);

    if (validation.error) {
      setAttendanceScheduleError(validation.error);
      setAttendanceScheduleMessage('');
      return;
    }

    setAttendanceScheduleSaving(true);
    setAttendanceScheduleMessage('');
    setAttendanceScheduleError('');

    try {
      const data = await api('/attendance/schedule-settings', {
        method: 'PUT',
        body: JSON.stringify(validation.values),
      });

      setAttendanceSchedule(getAttendanceScheduleFromResponse(data));
      setCanManageAttendanceSchedule(Boolean(data?.can_manage));
      setAttendanceScheduleSource(safeText(data?.source, 'tenant'));
      setAttendanceScheduleUpdatedAt(safeText(data?.updated_at));
      setAttendanceScheduleUpdatedBy(safeText(data?.updated_by_name));
      setAttendanceScheduleMessage(
        data?.message || 'Tenant attendance timings updated successfully.',
      );
    } catch (requestError) {
      setAttendanceScheduleError(
        requestError?.message ||
          'Unable to save attendance timings. Please try again.',
      );
    } finally {
      setAttendanceScheduleSaving(false);
    }
  }

  function updateAttendanceReason(setter, index, value) {
    setter((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, label: value } : item,
      ),
    );
    setAttendanceReasonMessage('');
    setAttendanceReasonError('');
  }

  function addAttendanceReason(setter) {
    setter((current) => {
      if (current.length >= MAX_ATTENDANCE_REASON_OPTIONS) {
        return current;
      }

      return [...current, { code: '', label: '' }];
    });
    setAttendanceReasonMessage('');
    setAttendanceReasonError('');
  }

  function removeAttendanceReason(setter, index) {
    setter((current) => {
      if (current.length <= 1) {
        return current;
      }

      return current.filter((_, itemIndex) => itemIndex !== index);
    });
    setAttendanceReasonMessage('');
    setAttendanceReasonError('');
  }

  function moveAttendanceReason(setter, fromIndex, toIndex) {
    setter((current) => {
      if (
        fromIndex < 0 ||
        fromIndex >= current.length ||
        toIndex < 0 ||
        toIndex >= current.length
      ) {
        return current;
      }

      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
    setAttendanceReasonMessage('');
    setAttendanceReasonError('');
  }

  function restoreDefaultAttendanceReasons() {
    setLateReasons(copyAttendanceReasons(DEFAULT_LATE_REASON_OPTIONS));
    setEarlyCheckoutReasons(
      copyAttendanceReasons(DEFAULT_EARLY_CHECKOUT_REASON_OPTIONS),
    );
    setAttendanceReasonError('');
    setAttendanceReasonMessage(
      'Default reasons restored in the editor. Select Save Attendance Reasons to apply them.',
    );
  }

  async function saveAttendanceReasons(event) {
    event.preventDefault();

    if (!canEditAttendanceReasons) {
      setAttendanceReasonError(
        'Only tenant HR/Admin can change attendance reasons.',
      );
      return;
    }

    const normalizedLateReasons = validateAttendanceReasonOptions(
      lateReasons,
      'Late check-in reasons',
    );

    if (normalizedLateReasons.error) {
      setAttendanceReasonError(normalizedLateReasons.error);
      setAttendanceReasonMessage('');
      return;
    }

    const normalizedEarlyReasons = validateAttendanceReasonOptions(
      earlyCheckoutReasons,
      'Early checkout reasons',
    );

    if (normalizedEarlyReasons.error) {
      setAttendanceReasonError(normalizedEarlyReasons.error);
      setAttendanceReasonMessage('');
      return;
    }

    setAttendanceReasonsSaving(true);
    setAttendanceReasonMessage('');
    setAttendanceReasonError('');

    try {
      const data = await api('/attendance/reason-settings', {
        method: 'PUT',
        body: JSON.stringify({
          late_reasons: normalizedLateReasons.values,
          early_checkout_reasons: normalizedEarlyReasons.values,
        }),
      });

      setLateReasons(
        editableAttendanceReasons(
          data?.late_reasons,
          DEFAULT_LATE_REASON_OPTIONS,
        ),
      );
      setEarlyCheckoutReasons(
        editableAttendanceReasons(
          data?.early_checkout_reasons,
          DEFAULT_EARLY_CHECKOUT_REASON_OPTIONS,
        ),
      );
      setCanManageAttendanceReasons(Boolean(data?.can_manage));
      setAttendanceReasonSource(safeText(data?.source, 'tenant'));
      setAttendanceReasonUpdatedAt(safeText(data?.updated_at));
      setAttendanceReasonUpdatedBy(safeText(data?.updated_by_name));
      setAttendanceReasonMessage(
        data?.message || 'Attendance reasons updated successfully.',
      );
    } catch (requestError) {
      setAttendanceReasonError(
        requestError?.message ||
          'Unable to save attendance reasons. Please try again.',
      );
    } finally {
      setAttendanceReasonsSaving(false);
    }
  }

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

    const confirmed = await showConfirm(
      'Remove the global YourComate logo? The sidebar will use the YC initials until another logo is uploaded.',
      'Remove YourComate logo?',
      {
        danger: true,
        confirmLabel: 'Remove Logo',
      },
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

    const confirmed = await showConfirm(
      'Remove the company logo from this tenant? The dashboards will fall back to the company initials.',
      'Remove company logo?',
      {
        danger: true,
        confirmLabel: 'Remove Logo',
      },
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
    <div className="page-grid settings-branding-page">
      <style>{`
        .settings-branding-page {
          --st-ink: #101a3a;
          --st-ink-2: #263553;
          --st-purple: #6658dc;
          --st-purple-deep: #40348d;
          --st-purple-soft: #f1efff;
          --st-cream: #f7fbff;
          --st-paper: #ffffff;
          --st-lime: #18b5c8;
          --st-cobalt: #4f65d7;
          --st-sky: #c6d8f7;
          --st-coral: #d4576f;
          --st-pink: #efb4c1;
          --st-lilac: #c9c0ff;
          --st-mint: #aee6d9;
          --st-yellow: #ffe0a5;
          --st-border: rgba(16, 26, 58, .14);
          --st-border-strong: rgba(16, 26, 58, .23);
          --st-muted: #5d6d8d;
          --st-shadow-sm: 0 12px 30px rgba(34, 38, 110, .07);
          --st-shadow-md: 0 24px 42px rgba(34, 38, 110, .10);
          --st-shadow-lg: 0 32px 86px rgba(22, 29, 73, .26);
          position: relative;
          isolation: isolate;
          display: grid;
          gap: clamp(18px, 2vw, 26px);
          width: 100%;
          min-width: 0;
          max-width: 100%;
          padding: clamp(2px, .35vw, 6px);
          padding-bottom: max(34px, env(safe-area-inset-bottom));
          color: var(--st-ink);
          font-family: var(--yc-ui, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
        }

        .settings-branding-page,
        .settings-branding-page * {
          box-sizing: border-box;
        }

        .settings-branding-page button,
        .settings-branding-page input,
        .settings-branding-page select,
        .settings-branding-page textarea {
          font: inherit;
        }

        .settings-branding-page img,
        .settings-branding-page svg {
          max-width: 100%;
        }

        .settings-branding-page button {
          -webkit-tap-highlight-color: transparent;
        }

        .settings-branding-page button:focus-visible,
        .settings-branding-page input:focus-visible,
        .settings-branding-page select:focus-visible,
        .settings-branding-page textarea:focus-visible,
        .settings-branding-page label:focus-within {
          outline: none;
        }

        .settings-branding-page input:focus-visible,
        .settings-branding-page select:focus-visible,
        .settings-branding-page textarea:focus-visible {
          border-color: var(--st-purple) !important;
          box-shadow: 0 0 0 4px rgba(101, 88, 217, .13);
        }

        .platform-branding-panel {
          position: relative;
          min-width: 0;
          overflow: hidden;
          border: 1px solid rgba(171, 181, 211, .70);
          border-radius: clamp(26px, 2.2vw, 36px);
          padding: clamp(20px, 2.6vw, 34px);
          background: linear-gradient(
            90deg,
            #d3f4fb 0%,
            #f7fcfb 34%,
            #fffdf8 52%,
            #fbf8fa 68%,
            #f0edfb 100%
          );
          box-shadow:
            8px 10px 0 #c4ccff,
            var(--st-shadow-md);
        }

        .payroll-branding-panel,
        .attendance-settings-panel,
        .tenant-branding-panel {
          position: relative;
          min-width: 0;
          overflow: hidden;
          border: 1px solid rgba(171, 181, 211, .70);
          border-radius: clamp(26px, 2.2vw, 36px);
          padding: clamp(20px, 2.6vw, 34px);
          background: linear-gradient(145deg, #ffffff, #f7fbff);
          box-shadow:
            8px 10px 0 #c4ccff,
            var(--st-shadow-md);
        }

        .platform-branding-panel::before,
        .payroll-branding-panel::before,
        .attendance-settings-panel::before,
        .tenant-branding-panel::before {
          content: none;
          display: none;
        }

        .platform-branding-panel > *,
        .payroll-branding-panel > *,
        .attendance-settings-panel > *,
        .tenant-branding-panel > * {
          position: relative;
          z-index: 1;
        }

        .platform-branding-panel,
        .payroll-branding-panel,
        .attendance-settings-panel,
        .tenant-branding-panel,
        .platform-brand-preview,
        .platform-brand-editor,
        .payroll-brand-preview,
        .payroll-brand-editor,
        .tenant-brand-preview,
        .tenant-brand-editor,
        .attendance-reason-list-card,
        .attendance-time-card,
        .payroll-brand-preview-card {
          transition:
            transform .22s ease,
            box-shadow .22s ease,
            border-color .22s ease,
            background .22s ease;
        }

        .platform-branding-heading,
        .payroll-branding-heading,
        .attendance-settings-heading,
        .tenant-branding-heading {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 20px;
          margin-bottom: clamp(20px, 2.2vw, 30px);
          min-width: 0;
        }

        .platform-branding-heading > div,
        .payroll-branding-heading > div,
        .attendance-settings-heading > div,
        .tenant-branding-heading > div {
          min-width: 0;
          max-width: 860px;
        }

        .platform-branding-kicker,
        .payroll-branding-kicker,
        .attendance-settings-kicker,
        .tenant-branding-kicker {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          width: fit-content;
          max-width: 100%;
          margin: 0 0 10px;
          padding: 9px 13px;
          border: 0;
          border-radius: 999px;
          color: #ffffff;
          background: #342b78;
          box-shadow: 4px 5px 0 #18b5c8;
          font-size: 9px;
          line-height: 1;
          font-weight: 950;
          letter-spacing: .12em;
          text-transform: uppercase;
          white-space: normal;
        }

        .platform-branding-heading h1,
        .payroll-branding-heading h1,
        .attendance-settings-heading h1,
        .tenant-branding-heading h1 {
          margin: 0;
          color: var(--st-ink);
          font-family: var(--yc-display, "Cormorant Garamond", Georgia, serif);
          font-size: clamp(30px, 3.1vw, 46px);
          font-weight: 800;
          line-height: .98;
          letter-spacing: -.035em;
          overflow-wrap: anywhere;
        }

        .platform-branding-heading p,
        .payroll-branding-heading p,
        .attendance-settings-heading p,
        .tenant-branding-heading p {
          max-width: 820px;
          margin: 12px 0 0;
          color: var(--st-muted);
          font-size: 15px;
          line-height: 1.68;
          font-weight: 550;
          overflow-wrap: anywhere;
        }

        .platform-branding-refresh,
        .payroll-branding-refresh,
        .attendance-settings-refresh,
        .tenant-branding-refresh {
          display: grid;
          place-items: center;
          width: 46px;
          height: 46px;
          flex: 0 0 46px;
          border: 1px solid rgba(65, 55, 161, .18);
          border-radius: 15px;
          color: #40348d;
          background: #ffffff;
          box-shadow: 3px 4px 0 rgba(52, 43, 120, .10);
          cursor: pointer;
          transition: transform .2s ease, border-color .2s ease, box-shadow .2s ease, background .2s ease;
        }

        .platform-branding-refresh:hover:not(:disabled),
        .payroll-branding-refresh:hover:not(:disabled),
        .attendance-settings-refresh:hover:not(:disabled),
        .tenant-branding-refresh:hover:not(:disabled) {
          transform: translateY(-2px);
          border-color: rgba(102, 88, 220, .34);
          background: #f8f7ff;
          box-shadow: 4px 5px 0 rgba(52, 43, 120, .13);
        }

        .platform-branding-refresh:disabled,
        .payroll-branding-refresh:disabled,
        .attendance-settings-refresh:disabled,
        .tenant-branding-refresh:disabled {
          cursor: not-allowed;
          opacity: .48;
          transform: none;
          box-shadow: none;
        }

        .platform-branding-layout,
        .payroll-branding-layout,
        .tenant-branding-layout {
          display: grid;
          grid-template-columns: minmax(280px, .92fr) minmax(380px, 1.08fr);
          gap: clamp(16px, 2vw, 24px);
          align-items: stretch;
          min-width: 0;
        }

        .platform-brand-preview,
        .platform-brand-editor,
        .payroll-brand-preview,
        .payroll-brand-editor,
        .tenant-brand-preview,
        .tenant-brand-editor {
          min-width: 0;
          border: 1px solid rgba(171, 181, 211, .56);
          border-radius: 24px;
          background: rgba(255, 255, 255, .94);
          box-shadow:
            4px 5px 0 rgba(196, 204, 255, .58),
            0 14px 28px rgba(34, 38, 110, .06);
        }

        .platform-brand-preview,
        .payroll-brand-preview,
        .tenant-brand-preview {
          display: grid;
          place-items: center;
          padding: clamp(22px, 2.4vw, 30px);
        }

        .platform-brand-editor,
        .payroll-brand-editor,
        .tenant-brand-editor {
          display: grid;
          align-content: center;
          gap: 18px;
          padding: clamp(22px, 2.4vw, 30px);
        }

        .platform-brand-editor h2,
        .payroll-brand-editor h2,
        .tenant-brand-editor h2 {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
          margin: 0;
          color: var(--st-ink);
          font-size: clamp(20px, 1.5vw, 24px);
          line-height: 1.2;
          font-weight: 900;
          letter-spacing: -.02em;
        }

        .platform-brand-editor > p,
        .payroll-brand-editor > p,
        .tenant-brand-editor > p {
          margin: -8px 0 0;
          color: var(--st-muted);
          font-size: 14.5px;
          line-height: 1.65;
          overflow-wrap: anywhere;
        }

        .platform-sidebar-preview {
          position: relative;
          width: min(100%, 420px);
          display: grid;
          grid-template-columns: 84px minmax(0, 1fr);
          align-items: center;
          gap: 18px;
          padding: 20px;
          border: 1px solid rgba(21, 21, 47, .12);
          border-radius: 24px;
          background:
            linear-gradient(145deg, #ffffff, #fbf9ff 70%);
          box-shadow: 0 22px 44px rgba(48, 39, 95, .12);
          overflow: hidden;
        }


        .platform-logo-preview {
          width: 84px;
          height: 84px;
          display: grid;
          place-items: center;
          overflow: hidden;
          border-radius: 24px;
          background:
            linear-gradient(145deg, var(--st-purple-deep), var(--st-purple));
          color: #fff;
          font-size: 26px;
          font-weight: 950;
          letter-spacing: -.04em;
          box-shadow: 0 14px 28px rgba(48, 39, 95, .24);
        }

        .platform-logo-preview img,
        .payroll-logo-preview img,
        .tenant-logo-preview img {
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
          color: var(--st-ink);
          font-family: var(--yc-display, "Cormorant Garamond", Georgia, serif);
          font-size: clamp(27px, 2.3vw, 35px);
          line-height: 1;
          font-weight: 800;
          letter-spacing: -.035em;
          overflow-wrap: anywhere;
        }

        .platform-preview-copy p {
          margin: 8px 0 0;
          color: var(--st-muted);
          font-size: 14px;
          line-height: 1.5;
          font-weight: 650;
          overflow-wrap: anywhere;
        }

        .platform-tagline-field {
          display: grid;
          gap: 9px;
          min-width: 0;
        }

        .platform-tagline-field label {
          color: var(--st-ink-2);
          font-size: 14px;
          line-height: 1.3;
          font-weight: 850;
        }

        .platform-tagline-input-wrap {
          position: relative;
          min-width: 0;
        }

        .platform-tagline-input-wrap svg {
          position: absolute;
          left: 15px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--st-purple);
          pointer-events: none;
        }

        .platform-tagline-input,
        .payroll-organisation-select,
        .attendance-time-card input,
        .attendance-reason-edit-row input {
          width: 100%;
          min-width: 0;
          border: 1px solid rgba(151, 161, 197, .58);
          background: rgba(255, 255, 255, .98);
          color: var(--st-ink);
          outline: none;
          transition: border-color .18s ease, box-shadow .18s ease, background .18s ease;
        }

        .platform-tagline-input {
          min-height: 50px;
          border-radius: 16px;
          padding: 12px 15px 12px 46px;
          font-size: 15px;
          font-weight: 700;
        }

        .platform-tagline-input:disabled,
        .payroll-organisation-select:disabled,
        .attendance-time-card input:disabled,
        .attendance-reason-edit-row input:disabled {
          cursor: not-allowed;
          background: rgba(245, 240, 232, .64);
          color: #858097;
        }

        .platform-tagline-meta {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
          min-width: 0;
          color: var(--st-muted);
          font-size: 12.5px;
          line-height: 1.45;
          font-weight: 650;
        }

        .platform-tagline-meta span:first-child {
          min-width: 0;
          overflow-wrap: anywhere;
        }

        .platform-tagline-meta span:last-child {
          flex: 0 0 auto;
          font-variant-numeric: tabular-nums;
        }

        .platform-logo-dropzone,
        .payroll-logo-dropzone,
        .tenant-logo-dropzone {
          display: grid;
          grid-template-columns: 50px minmax(0, 1fr);
          align-items: center;
          gap: 14px;
          min-width: 0;
          padding: 16px;
          border: 1.5px dashed rgba(102, 88, 220, .38);
          border-radius: 18px;
          background: linear-gradient(135deg, #f1efff, #ffffff);
          cursor: pointer;
          transition: transform .2s ease, border-color .2s ease, background .2s ease, box-shadow .2s ease;
        }

        .payroll-logo-dropzone {
          border-color: rgba(79, 101, 215, .34);
          background: linear-gradient(135deg, #edf6ff, #ffffff);
        }

        .tenant-logo-dropzone {
          border-color: rgba(102, 88, 220, .31);
          background: linear-gradient(135deg, #f5f3ff, #ffffff);
        }

        .platform-logo-dropzone:hover:not(.is-disabled),
        .payroll-logo-dropzone:hover:not(.is-disabled),
        .tenant-logo-dropzone:hover:not(.is-disabled) {
          transform: translateY(-2px);
          border-color: var(--st-purple);
          background: #ffffff;
          box-shadow: 0 14px 28px rgba(21, 21, 47, .08);
        }

        .platform-logo-dropzone.is-disabled,
        .payroll-logo-dropzone.is-disabled,
        .tenant-logo-dropzone.is-disabled {
          cursor: not-allowed;
          opacity: .55;
          transform: none;
          box-shadow: none;
        }

        .platform-logo-dropzone input,
        .payroll-logo-dropzone input,
        .tenant-logo-dropzone input {
          display: none;
        }

        .platform-logo-dropzone-icon,
        .payroll-logo-dropzone-icon,
        .tenant-logo-dropzone-icon {
          width: 50px;
          height: 50px;
          display: grid;
          place-items: center;
          border-radius: 16px;
          color: var(--st-purple-deep);
          background: var(--st-purple-soft);
        }

        .payroll-logo-dropzone-icon {
          color: #24479f;
          background: rgba(191, 231, 255, .58);
        }

        .tenant-logo-dropzone-icon {
          color: #5a3d79;
          background: rgba(201, 183, 255, .30);
        }

        .platform-logo-dropzone strong,
        .platform-logo-dropzone span,
        .payroll-logo-dropzone strong,
        .payroll-logo-dropzone span,
        .tenant-logo-dropzone strong,
        .tenant-logo-dropzone span {
          min-width: 0;
          display: block;
        }

        .platform-logo-dropzone strong,
        .payroll-logo-dropzone strong,
        .tenant-logo-dropzone strong {
          color: var(--st-ink-2);
          font-size: 14.5px;
          line-height: 1.35;
          font-weight: 850;
          overflow-wrap: anywhere;
        }

        .platform-logo-dropzone span span,
        .payroll-logo-dropzone span span,
        .tenant-logo-dropzone span span {
          margin-top: 4px;
          color: var(--st-muted);
          font-size: 12.5px;
          line-height: 1.45;
          font-weight: 600;
          overflow-wrap: anywhere;
        }

        .platform-logo-file-meta,
        .payroll-logo-file-meta,
        .tenant-logo-file-meta {
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 9px;
          border: 1px solid rgba(127, 208, 174, .28);
          border-radius: 14px;
          background: rgba(127, 208, 174, .12);
          padding: 10px 12px;
          color: #316f5a;
          font-size: 13px;
          font-weight: 750;
        }

        .platform-logo-file-meta span,
        .payroll-logo-file-meta span,
        .tenant-logo-file-meta span {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .platform-brand-actions,
        .payroll-brand-actions,
        .tenant-brand-actions,
        .attendance-settings-actions {
          display: flex;
          align-items: center;
          justify-content: flex-start;
          gap: 10px;
          flex-wrap: wrap;
          min-width: 0;
        }

        .attendance-settings-actions {
          justify-content: flex-end;
        }

        .platform-brand-actions button,
        .payroll-brand-actions button,
        .tenant-brand-actions button,
        .attendance-settings-actions button,
        .attendance-reason-list-footer button {
          min-height: 44px;
          max-width: 100%;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          border-radius: 15px;
          padding: 10px 17px;
          font-size: 13.5px;
          line-height: 1.2;
          font-weight: 850;
          cursor: pointer;
          transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease, background .18s ease, color .18s ease;
          white-space: normal;
          text-align: center;
        }

        .platform-brand-save,
        .payroll-logo-save,
        .tenant-logo-save,
        .attendance-reasons-save {
          border: 1px solid rgba(76, 118, 220, .18);
          color: #ffffff;
          background: linear-gradient(135deg, #4c76dc 0%, #2db6b7 100%);
          box-shadow:
            6px 7px 0 #595192,
            0 14px 25px rgba(67, 116, 170, .16);
        }

        .platform-brand-save:hover:not(:disabled),
        .payroll-logo-save:hover:not(:disabled),
        .tenant-logo-save:hover:not(:disabled),
        .attendance-reasons-save:hover:not(:disabled) {
          transform: translateY(-2px);
          color: #ffffff;
          background: linear-gradient(135deg, #4c76dc 0%, #2db6b7 100%);
          border-color: rgba(76, 118, 220, .26);
          box-shadow:
            7px 8px 0 #595192,
            0 17px 30px rgba(67, 116, 170, .18);
        }

        .platform-logo-remove,
        .payroll-logo-remove,
        .tenant-logo-remove {
          border: 1px solid rgba(162, 52, 77, .22);
          background: #fff0f2;
          color: #a2344d;
          box-shadow: 3px 4px 0 #f2c2cc;
        }

        .platform-logo-remove:hover:not(:disabled),
        .payroll-logo-remove:hover:not(:disabled),
        .tenant-logo-remove:hover:not(:disabled) {
          transform: translateY(-2px);
          border-color: rgba(162, 52, 77, .34);
          background: #fff0f2;
        }

        .payroll-designer-open,
        .attendance-reasons-reset {
          border: 1px solid rgba(65, 55, 161, .18);
          background: #ffffff;
          color: #40348d;
          box-shadow: 3px 4px 0 rgba(52, 43, 120, .10);
        }

        .payroll-designer-open:hover:not(:disabled),
        .attendance-reasons-reset:hover:not(:disabled) {
          transform: translateY(-2px);
          border-color: rgba(102, 88, 220, .34);
          background: #f8f7ff;
        }

        .platform-brand-actions button:disabled,
        .payroll-brand-actions button:disabled,
        .tenant-brand-actions button:disabled,
        .attendance-settings-actions button:disabled,
        .attendance-reason-list-footer button:disabled {
          cursor: not-allowed;
          opacity: .46;
          transform: none !important;
          box-shadow: none !important;
        }

        .platform-brand-permission,
        .payroll-brand-permission,
        .tenant-brand-permission,
        .attendance-reason-permission {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          min-width: 0;
          padding: 13px 15px;
          border: 1px solid rgba(79, 101, 215, .16);
          border-radius: 14px;
          color: #304f97;
          background: #edf6ff;
          box-shadow: 3px 4px 0 #c6def6;
          font-size: 12px;
          line-height: 1.5;
          font-weight: 750;
          overflow-wrap: anywhere;
        }

        .settings-inline-message {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          gap: 9px;
          align-items: start;
          width: 100%;
          min-width: 0;
          padding: 10px 11px;
          border: 1px solid rgba(102, 88, 220, .18);
          border-radius: 12px;
          color: #40348d;
          background: #f1efff;
          box-shadow: 3px 4px 0 #c9c0ff;
          font-size: 10.5px;
          line-height: 1.45;
        }

        .settings-inline-message.success {
          border-color: rgba(4, 120, 87, .18);
          color: #047857;
          background: #eaf8f4;
          box-shadow: 3px 4px 0 #aee6d9;
        }

        .settings-inline-message.error {
          border-color: rgba(162, 52, 77, .18);
          color: #a2344d;
          background: #fff0f2;
          box-shadow: 3px 4px 0 #f2c2cc;
        }

        .settings-inline-message.warning {
          border-color: rgba(154, 104, 23, .18);
          color: #9a6817;
          background: #fff4d5;
          box-shadow: 3px 4px 0 #ffe0a5;
        }

        .settings-inline-message-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          flex: 0 0 22px;
        }

        .settings-inline-message-copy {
          min-width: 0;
        }

        .settings-inline-message-copy strong,
        .settings-inline-message-copy > span {
          display: block;
          overflow-wrap: anywhere;
        }

        .settings-inline-message-copy strong {
          margin-bottom: 2px;
          font-size: 10px;
          font-weight: 950;
        }

        .settings-inline-message-copy > span {
          font-weight: 750;
        }

        .settings-inline-message-close {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          min-width: 24px;
          height: 24px;
          margin: -2px -3px -2px 0;
          padding: 0;
          border: 0;
          border-radius: 8px;
          color: currentColor;
          background: rgba(255, 255, 255, .52);
          box-shadow: none;
          opacity: .72;
          cursor: pointer;
        }

        .settings-inline-message-close:hover {
          transform: none !important;
          filter: none !important;
          opacity: 1;
          background: rgba(255, 255, 255, .92);
        }

        .platform-brand-loading,
        .payroll-brand-loading,
        .tenant-brand-loading,
        .attendance-settings-loading {
          min-height: 220px;
          display: grid;
          place-items: center;
          color: var(--st-muted);
          font-size: 14px;
          font-weight: 800;
          text-align: center;
        }

        .platform-brand-loading span,
        .tenant-brand-loading span,
        .attendance-settings-loading span,
        .payroll-brand-loading {
          gap: 9px;
        }

        .platform-brand-loading span,
        .tenant-brand-loading span,
        .attendance-settings-loading span {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-wrap: wrap;
        }

        .tenant-brand-spin {
          animation: settings-spin .82s linear infinite;
        }

        @keyframes settings-spin {
          to { transform: rotate(360deg); }
        }

        .payroll-organisation-selector {
          min-width: 0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          margin: 0 0 18px;
          padding: 15px 17px;
          border: 1px solid rgba(79, 101, 215, .18);
          border-radius: 18px;
          background: #edf6ff;
          box-shadow: 3px 4px 0 #c6def6;
        }

        .payroll-organisation-selector-copy {
          min-width: 0;
          display: grid;
          gap: 4px;
        }

        .payroll-organisation-selector-copy span {
          color: #5e6c8e;
          font-size: 12px;
          line-height: 1.3;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: .08em;
        }

        .payroll-organisation-selector-copy strong {
          color: var(--st-ink);
          font-size: 14.5px;
          line-height: 1.4;
          font-weight: 850;
          overflow-wrap: anywhere;
        }

        .payroll-organisation-select {
          width: min(100%, 370px);
          min-height: 46px;
          flex: 0 1 370px;
          border-radius: 14px;
          padding: 10px 40px 10px 13px;
          font-size: 14px;
          font-weight: 750;
        }

        .payroll-brand-preview {
          align-items: stretch;
          background:
            linear-gradient(145deg, rgba(255, 255, 255, .90), rgba(236, 247, 255, .65));
        }

        .payroll-brand-preview-card {
          width: min(100%, 470px);
          min-width: 0;
          margin: auto;
          padding: clamp(20px, 2.2vw, 28px);
          border: 1px solid rgba(21, 21, 47, .12);
          border-radius: 22px;
          background: #fffefa;
          box-shadow: 0 18px 40px rgba(21, 21, 47, .10);
          text-align: center;
          position: relative;
          overflow: hidden;
        }

        .payroll-logo-preview {
          width: 92px;
          height: 92px;
          display: grid;
          place-items: center;
          margin: 0 auto 14px;
          overflow: hidden;
          border-radius: 24px;
          background: linear-gradient(145deg, var(--st-cobalt), var(--st-purple));
          color: #ffffff;
          box-shadow: 0 14px 28px rgba(49, 86, 216, .18);
          font-size: 24px;
          font-weight: 950;
          letter-spacing: -.04em;
        }

        .payroll-brand-preview-card h2 {
          margin: 0;
          color: var(--st-ink);
          font-family: var(--yc-display, "Cormorant Garamond", Georgia, serif);
          font-size: clamp(26px, 2vw, 34px);
          line-height: 1.04;
          font-weight: 800;
          letter-spacing: -.025em;
          overflow-wrap: anywhere;
        }

        .payroll-brand-preview-card > p:not(.payroll-brand-preview-title) {
          max-width: 390px;
          margin: 8px auto 0;
          color: var(--st-muted);
          font-size: 13px;
          line-height: 1.5;
          overflow-wrap: anywhere;
        }

        .payroll-brand-preview-divider {
          height: 1px;
          margin: 20px 0 15px;
          background: linear-gradient(90deg, transparent, rgba(21, 21, 47, .18), transparent);
        }

        .payroll-brand-preview-title {
          margin: 0 0 14px;
          color: var(--st-cobalt);
          font-size: 12px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: .14em;
        }

        .payroll-brand-status-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          text-align: left;
          min-width: 0;
        }

        .payroll-brand-status-item {
          min-width: 0;
          display: grid;
          gap: 5px;
          padding: 12px;
          border: 1px solid rgba(21, 21, 47, .09);
          border-radius: 14px;
          background: rgba(245, 240, 232, .46);
        }

        .payroll-brand-status-item span {
          color: var(--st-muted);
          font-size: 11px;
          line-height: 1.3;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: .06em;
        }

        .payroll-brand-status-item strong {
          min-width: 0;
          color: var(--st-ink-2);
          font-size: 12.5px;
          line-height: 1.45;
          font-weight: 800;
          overflow-wrap: anywhere;
        }

        .payroll-brand-note {
          min-width: 0;
          border: 1px solid rgba(101, 88, 217, .13);
          border-radius: 16px;
          background: rgba(238, 234, 255, .52);
          padding: 13px 14px;
          color: #5f5878;
          font-size: 13px;
          line-height: 1.56;
          font-weight: 650;
          overflow-wrap: anywhere;
        }

        .attendance-settings-form {
          display: grid;
          gap: 18px;
          min-width: 0;
        }

        .attendance-settings-meta {
          min-width: 0;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          padding: 13px 15px;
          border: 1px solid rgba(21, 21, 47, .09);
          border-radius: 16px;
          background: rgba(255, 255, 255, .66);
          color: var(--st-muted);
          font-size: 12.5px;
          line-height: 1.55;
          font-weight: 650;
        }

        .attendance-settings-meta > span:first-child {
          min-width: 0;
          overflow-wrap: anywhere;
        }

        .attendance-settings-source {
          flex: 0 0 auto;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border: 1px solid rgba(73, 155, 123, .18);
          border-radius: 999px;
          background: rgba(127, 208, 174, .13);
          padding: 6px 10px;
          color: #33705c;
          font-size: 11.5px;
          line-height: 1.2;
          font-weight: 850;
          white-space: nowrap;
        }

        .attendance-schedule-grid {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 12px;
          min-width: 0;
        }

        .attendance-time-card {
          min-width: 0;
          display: grid;
          align-content: start;
          gap: 7px;
          padding: 14px;
          border: 1px solid rgba(171, 181, 211, .52);
          border-radius: 18px;
          background: #ffffff;
          box-shadow: 3px 4px 0 rgba(196, 204, 255, .46);
        }

        .attendance-time-card:hover {
          border-color: rgba(101, 88, 217, .22);
          box-shadow: 0 12px 25px rgba(21, 21, 47, .07);
        }

        .attendance-time-card label {
          color: var(--st-ink-2);
          font-size: 13px;
          line-height: 1.3;
          font-weight: 900;
        }

        .attendance-time-card p {
          min-height: 38px;
          margin: 0;
          color: var(--st-muted);
          font-size: 11.5px;
          line-height: 1.45;
          font-weight: 600;
          overflow-wrap: anywhere;
        }

        .attendance-time-card input {
          min-height: 44px;
          border-radius: 13px;
          padding: 8px 10px;
          font-size: 14px;
          font-weight: 750;
        }

        .attendance-time-preview {
          min-width: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          flex-wrap: wrap;
          border: 1px solid rgba(73, 155, 123, .16);
          border-radius: 16px;
          background: rgba(127, 208, 174, .11);
          padding: 12px 14px;
          color: #4f6c61;
          font-size: 12.5px;
          line-height: 1.35;
        }

        .attendance-time-preview svg {
          color: #33705c;
        }

        .attendance-time-preview strong {
          color: var(--st-ink-2);
          font-size: 12.5px;
          font-weight: 850;
          font-variant-numeric: tabular-nums;
        }

        .attendance-time-preview span {
          font-weight: 650;
        }

        .attendance-reason-editor-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
          align-items: start;
          min-width: 0;
        }

        .attendance-reason-list-card {
          min-width: 0;
          display: grid;
          gap: 15px;
          padding: 18px;
          border: 1px solid rgba(171, 181, 211, .52);
          border-radius: 20px;
          background: #ffffff;
          box-shadow: 3px 4px 0 rgba(196, 204, 255, .46);
        }

        .attendance-reason-list-heading {
          min-width: 0;
          display: grid;
          grid-template-columns: 44px minmax(0, 1fr);
          align-items: start;
          gap: 12px;
        }

        .attendance-reason-list-icon {
          width: 44px;
          height: 44px;
          display: grid;
          place-items: center;
          border-radius: 14px;
          background: rgba(127, 208, 174, .16);
          color: #2f7159;
        }

        .attendance-reason-list-heading > div {
          min-width: 0;
        }

        .attendance-reason-list-heading h3 {
          margin: 1px 0 0;
          color: var(--st-ink);
          font-size: 16px;
          line-height: 1.25;
          font-weight: 900;
          overflow-wrap: anywhere;
        }

        .attendance-reason-list-heading p {
          margin: 5px 0 0;
          color: var(--st-muted);
          font-size: 12.5px;
          line-height: 1.5;
          overflow-wrap: anywhere;
        }

        .attendance-reason-list {
          display: grid;
          gap: 8px;
          min-width: 0;
        }

        .attendance-reason-edit-row {
          min-width: 0;
          display: grid;
          grid-template-columns: 30px minmax(0, 1fr) auto;
          align-items: center;
          gap: 8px;
        }

        .attendance-reason-number {
          width: 30px;
          height: 30px;
          display: grid;
          place-items: center;
          border-radius: 10px;
          background: rgba(238, 234, 255, .75);
          color: var(--st-purple-deep);
          font-size: 11px;
          font-weight: 900;
        }

        .attendance-reason-edit-row input {
          min-height: 42px;
          border-radius: 12px;
          padding: 9px 11px;
          font-size: 13.5px;
          line-height: 1.35;
          font-weight: 700;
        }

        .attendance-reason-row-actions {
          display: flex;
          align-items: center;
          gap: 5px;
          flex-wrap: nowrap;
        }

        .attendance-reason-row-actions button {
          width: 34px;
          height: 34px;
          flex: 0 0 34px;
          display: grid;
          place-items: center;
          border: 1px solid rgba(21, 21, 47, .12);
          border-radius: 11px;
          background: #ffffff;
          color: var(--st-purple-deep);
          cursor: pointer;
          transition: transform .18s ease, border-color .18s ease, background .18s ease;
        }

        .attendance-reason-row-actions button:hover:not(:disabled) {
          transform: translateY(-1px);
          border-color: rgba(101, 88, 217, .32);
          background: var(--st-purple-soft);
        }

        .attendance-reason-row-actions .attendance-reason-delete {
          color: #a74052;
          border-color: rgba(167, 64, 82, .18);
          background: rgba(255, 113, 91, .07);
        }

        .attendance-reason-row-actions button:disabled {
          cursor: not-allowed;
          opacity: .36;
          transform: none;
        }

        .attendance-reason-edit-row.is-locked {
          margin-top: 3px;
          padding-top: 10px;
          border-top: 1px dashed rgba(21, 21, 47, .16);
        }

        .attendance-reason-edit-row.is-locked .attendance-reason-number {
          background: rgba(191, 231, 255, .44);
          color: #3156a0;
        }

        .attendance-reason-locked-label {
          justify-self: end;
          border: 1px solid rgba(49, 86, 216, .15);
          border-radius: 999px;
          background: rgba(191, 231, 255, .28);
          padding: 6px 9px;
          color: #3156a0;
          font-size: 10.5px;
          line-height: 1;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: .06em;
          white-space: nowrap;
        }

        .attendance-reason-list-footer {
          min-width: 0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          flex-wrap: wrap;
          color: var(--st-muted);
          font-size: 12px;
          line-height: 1.4;
          font-weight: 700;
        }

        .attendance-reason-list-footer button {
          min-height: 38px;
          padding: 8px 13px;
          border: 1px solid rgba(73, 155, 123, .20);
          background: rgba(127, 208, 174, .12);
          color: #2f7159;
          box-shadow: none;
        }

        .attendance-reason-list-footer button:hover:not(:disabled) {
          transform: translateY(-1px);
          border-color: rgba(73, 155, 123, .38);
          background: rgba(127, 208, 174, .22);
        }

        .tenant-brand-preview {
          min-height: 315px;
          background:
            linear-gradient(145deg, rgba(255, 255, 255, .88), rgba(248, 244, 255, .68));
        }

        .tenant-brand-preview-inner {
          width: 100%;
          min-width: 0;
          display: grid;
          place-items: center;
          text-align: center;
        }

        .tenant-logo-preview {
          width: 126px;
          height: 126px;
          display: grid;
          place-items: center;
          overflow: hidden;
          border-radius: 32px;
          background: linear-gradient(145deg, var(--st-purple-deep), var(--st-purple));
          color: #ffffff;
          box-shadow: 0 20px 42px rgba(48, 39, 95, .20);
          font-size: 31px;
          line-height: 1;
          font-weight: 950;
          letter-spacing: -.05em;
        }

        .tenant-company-script {
          max-width: 100%;
          margin: 18px 0 0;
          color: var(--st-ink);
          font-family: var(--yc-display, "Cormorant Garamond", Georgia, serif);
          font-size: clamp(28px, 2.5vw, 38px);
          line-height: 1;
          font-weight: 800;
          letter-spacing: -.03em;
          overflow-wrap: anywhere;
        }

        .tenant-brand-preview-inner small {
          margin-top: 8px;
          color: var(--st-muted);
          font-size: 12.5px;
          line-height: 1.4;
          font-weight: 700;
        }

        .settings-confirm-backdrop {
          position: fixed;
          inset: 0;
          z-index: 12000;
          display: grid;
          place-items: center;
          width: 100vw;
          height: 100dvh;
          overflow: hidden;
          padding:
            max(18px, env(safe-area-inset-top))
            max(18px, env(safe-area-inset-right))
            max(18px, env(safe-area-inset-bottom))
            max(18px, env(safe-area-inset-left));
          background: rgba(15, 23, 42, .58);
          -webkit-backdrop-filter: blur(10px);
          backdrop-filter: blur(10px);
          overscroll-behavior: none;
          animation: settings-fade .18s ease both;
        }

        .settings-confirm-card {
          width: min(650px, calc(100vw - 36px));
          max-height: min(88dvh, 720px);
          overflow: hidden;
          border: 1px solid rgba(171, 181, 211, .74);
          border-radius: 26px;
          background: linear-gradient(145deg, #ffffff 0%, #f7fbff 55%, #f8f4ff 100%);
          box-shadow:
            0 32px 86px rgba(22, 29, 73, .32),
            9px 11px 0 rgba(185, 215, 255, .46);
          animation: settings-modal-in .22s ease both;
        }

        .settings-confirm-header {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          gap: 13px;
          align-items: center;
          padding: 19px 20px 16px;
          border-bottom: 1px solid rgba(171, 181, 211, .42);
          background: linear-gradient(135deg, rgba(237, 246, 255, .97), rgba(248, 247, 255, .98));
        }

        .settings-confirm-icon {
          display: grid;
          place-items: center;
          width: 44px;
          height: 44px;
          border-radius: 14px;
          color: #40348d;
          background: #f1efff;
          box-shadow: 3px 4px 0 #c9c0ff;
        }

        .settings-confirm-icon.is-danger {
          color: #a2344d;
          background: #fff0f2;
          box-shadow: 3px 4px 0 #f2c2cc;
        }

        .settings-confirm-title {
          min-width: 0;
        }

        .settings-confirm-title > span {
          display: block;
          color: #6b7692;
          font-size: 8px;
          font-weight: 950;
          letter-spacing: .09em;
          text-transform: uppercase;
        }

        .settings-confirm-title h3 {
          margin: 4px 0 0;
          color: #101a3a;
          font-family: var(--yc-display, Georgia, "Times New Roman", serif);
          font-size: clamp(22px, 2.3vw, 29px);
          font-weight: 760;
          line-height: 1.08;
          letter-spacing: -.025em;
          overflow-wrap: anywhere;
        }

        .settings-confirm-close {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 38px;
          min-width: 38px;
          height: 38px;
          padding: 0;
          border: 1px solid rgba(65, 55, 161, .18);
          border-radius: 12px;
          color: #40348d;
          background: #ffffff;
          box-shadow: 3px 4px 0 rgba(52, 43, 120, .10);
          cursor: pointer;
        }

        .settings-confirm-body {
          padding: 24px 22px;
        }

        .settings-confirm-body p {
          margin: 0;
          color: #5d6d8d;
          font-size: 13px;
          line-height: 1.65;
          font-weight: 700;
          overflow-wrap: anywhere;
        }

        .settings-confirm-actions {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          padding: 18px 22px 22px;
          border-top: 1px solid rgba(171, 181, 211, .38);
          background: rgba(248, 250, 255, .72);
        }

        .settings-confirm-actions button {
          min-height: 48px;
          padding: 0 15px;
          border-radius: 15px;
          font-size: 12px;
          font-weight: 900;
          cursor: pointer;
        }

        .settings-confirm-cancel {
          border: 1px solid rgba(65, 55, 161, .18);
          color: #40348d;
          background: #ffffff;
          box-shadow: 3px 4px 0 rgba(52, 43, 120, .10);
        }

        .settings-confirm-submit {
          border: 1px solid rgba(76, 118, 220, .18);
          color: #ffffff;
          background: linear-gradient(135deg, #4c76dc 0%, #2db6b7 100%);
          box-shadow: 5px 6px 0 #595192;
        }

        .settings-confirm-submit.is-danger {
          border-color: rgba(162, 52, 77, .22);
          background: linear-gradient(135deg, #a2344d, #d4576f);
          box-shadow: 4px 5px 0 #efb4c1;
        }

        .settings-confirm-card.is-danger,
        .settings-confirm-card.is-danger:hover,
        .settings-confirm-card.is-danger .settings-confirm-submit.is-danger:hover {
          transform: none !important;
          filter: none !important;
        }

        .settings-confirm-actions button:disabled,
        .settings-confirm-close:disabled {
          cursor: not-allowed;
          opacity: .5;
          transform: none;
        }

        @keyframes settings-fade {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes settings-modal-in {
          from { opacity: 0; transform: translateY(10px) scale(.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        @media (min-width: 1181px) {
          .platform-branding-panel:hover,
          .payroll-branding-panel:hover,
          .attendance-settings-panel:hover,
          .tenant-branding-panel:hover {
            border-color: rgba(101, 88, 217, .18);
          }
        }

        @media (max-width: 1180px) {
          .platform-branding-layout,
          .payroll-branding-layout,
          .tenant-branding-layout {
            grid-template-columns: minmax(250px, .88fr) minmax(330px, 1.12fr);
          }

          .attendance-schedule-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .attendance-time-card:last-child {
            grid-column: span 1;
          }
        }

        @media (max-width: 980px) {
          .settings-branding-page {
            gap: 20px;
            padding: 2px;
          }

          .platform-branding-panel,
          .payroll-branding-panel,
          .attendance-settings-panel,
          .tenant-branding-panel {
            padding: 22px;
            border-radius: 28px;
          }

          .platform-branding-layout,
          .payroll-branding-layout,
          .tenant-branding-layout {
            grid-template-columns: 1fr;
          }

          .platform-brand-preview,
          .payroll-brand-preview,
          .tenant-brand-preview {
            min-height: 260px;
          }

          .attendance-reason-editor-grid {
            grid-template-columns: 1fr;
          }

          .payroll-organisation-selector {
            align-items: stretch;
            flex-direction: column;
          }

          .payroll-organisation-select {
            width: 100%;
            flex-basis: auto;
          }
        }

        @media (max-width: 760px) {
          .platform-branding-heading,
          .payroll-branding-heading,
          .attendance-settings-heading,
          .tenant-branding-heading {
            gap: 14px;
            align-items: flex-start;
          }

          .platform-branding-heading h1,
          .payroll-branding-heading h1,
          .attendance-settings-heading h1,
          .tenant-branding-heading h1 {
            font-size: clamp(29px, 8vw, 38px);
          }

          .platform-branding-heading p,
          .payroll-branding-heading p,
          .attendance-settings-heading p,
          .tenant-branding-heading p {
            font-size: 14.5px;
          }

          .attendance-schedule-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .attendance-settings-meta {
            flex-direction: column;
            align-items: stretch;
          }

          .attendance-settings-source {
            width: fit-content;
          }

          .platform-brand-actions,
          .payroll-brand-actions,
          .tenant-brand-actions,
          .attendance-settings-actions {
            align-items: stretch;
          }

          .platform-brand-actions button,
          .payroll-brand-actions button,
          .tenant-brand-actions button {
            flex: 1 1 calc(50% - 8px);
          }

          .attendance-settings-actions button {
            flex: 1 1 auto;
          }
        }

        @media (max-width: 560px) {
          .settings-branding-page {
            gap: 16px;
          }

          .platform-branding-panel,
          .payroll-branding-panel,
          .attendance-settings-panel,
          .tenant-branding-panel {
            padding: 17px;
            border-radius: 22px;
          }

          .platform-branding-heading,
          .payroll-branding-heading,
          .attendance-settings-heading,
          .tenant-branding-heading {
            margin-bottom: 18px;
          }

          .platform-branding-refresh,
          .payroll-branding-refresh,
          .attendance-settings-refresh,
          .tenant-branding-refresh {
            width: 42px;
            height: 42px;
            flex-basis: 42px;
            border-radius: 13px;
          }

          .platform-branding-kicker,
          .payroll-branding-kicker,
          .attendance-settings-kicker,
          .tenant-branding-kicker {
            font-size: 10.5px;
            padding: 6px 9px;
          }

          .platform-branding-heading h1,
          .payroll-branding-heading h1,
          .attendance-settings-heading h1,
          .tenant-branding-heading h1 {
            font-size: 31px;
          }

          .platform-branding-heading p,
          .payroll-branding-heading p,
          .attendance-settings-heading p,
          .tenant-branding-heading p {
            margin-top: 9px;
            font-size: 14px;
            line-height: 1.58;
          }

          .platform-brand-preview,
          .platform-brand-editor,
          .payroll-brand-preview,
          .payroll-brand-editor,
          .tenant-brand-preview,
          .tenant-brand-editor {
            border-radius: 19px;
            padding: 17px;
          }

          .platform-sidebar-preview {
            grid-template-columns: 66px minmax(0, 1fr);
            gap: 13px;
            padding: 15px;
            border-radius: 18px;
          }

          .platform-logo-preview {
            width: 66px;
            height: 66px;
            border-radius: 18px;
            font-size: 21px;
          }

          .platform-preview-copy h2 {
            font-size: 27px;
          }

          .platform-tagline-meta {
            flex-direction: column;
            gap: 3px;
          }

          .platform-logo-dropzone,
          .payroll-logo-dropzone,
          .tenant-logo-dropzone {
            grid-template-columns: 44px minmax(0, 1fr);
            gap: 11px;
            padding: 13px;
            border-radius: 16px;
          }

          .platform-logo-dropzone-icon,
          .payroll-logo-dropzone-icon,
          .tenant-logo-dropzone-icon {
            width: 44px;
            height: 44px;
            border-radius: 13px;
          }

          .platform-brand-actions button,
          .payroll-brand-actions button,
          .tenant-brand-actions button,
          .attendance-settings-actions button {
            flex: 1 1 100%;
            width: 100%;
          }

          .payroll-brand-preview-card {
            padding: 20px 15px;
            border-radius: 18px;
          }

          .payroll-brand-status-grid {
            grid-template-columns: 1fr;
          }

          .payroll-logo-preview {
            width: 78px;
            height: 78px;
            border-radius: 20px;
            font-size: 21px;
          }

          .payroll-organisation-selector {
            padding: 13px;
            border-radius: 15px;
          }

          .attendance-schedule-grid {
            grid-template-columns: 1fr;
          }

          .attendance-time-card p {
            min-height: 0;
          }

          .attendance-time-preview {
            justify-content: flex-start;
            gap: 7px;
          }

          .attendance-time-preview > span:not(:last-child) {
            overflow-wrap: anywhere;
          }

          .attendance-reason-list-card {
            padding: 14px;
            border-radius: 17px;
          }

          .attendance-reason-edit-row {
            grid-template-columns: 28px minmax(0, 1fr);
            align-items: center;
          }

          .attendance-reason-number {
            width: 28px;
            height: 28px;
          }

          .attendance-reason-row-actions {
            grid-column: 2;
            justify-content: flex-end;
            padding-top: 2px;
          }

          .attendance-reason-locked-label {
            grid-column: 2;
            justify-self: end;
          }

          .tenant-logo-preview {
            width: 108px;
            height: 108px;
            border-radius: 27px;
          }

          .tenant-company-script {
            font-size: 30px;
          }

          .settings-confirm-actions {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 420px) {
          .settings-branding-page {
            padding: 0;
          }

          .platform-branding-panel,
          .payroll-branding-panel,
          .attendance-settings-panel,
          .tenant-branding-panel {
            padding: 15px;
            border-radius: 19px;
          }

          .platform-branding-heading,
          .payroll-branding-heading,
          .attendance-settings-heading,
          .tenant-branding-heading {
            gap: 10px;
          }

          .platform-branding-heading h1,
          .payroll-branding-heading h1,
          .attendance-settings-heading h1,
          .tenant-branding-heading h1 {
            font-size: 28px;
          }

          .platform-branding-refresh,
          .payroll-branding-refresh,
          .attendance-settings-refresh,
          .tenant-branding-refresh {
            width: 40px;
            height: 40px;
            flex-basis: 40px;
          }

          .platform-sidebar-preview {
            grid-template-columns: 58px minmax(0, 1fr);
            gap: 10px;
            padding: 12px;
          }

          .platform-logo-preview {
            width: 58px;
            height: 58px;
            border-radius: 16px;
            font-size: 19px;
          }

          .platform-preview-copy h2 {
            font-size: 24px;
          }

          .platform-preview-copy p {
            font-size: 12.5px;
          }

          .platform-brand-editor,
          .payroll-brand-editor,
          .tenant-brand-editor,
          .platform-brand-preview,
          .payroll-brand-preview,
          .tenant-brand-preview {
            padding: 14px;
          }

          .attendance-reason-list-heading {
            grid-template-columns: 40px minmax(0, 1fr);
            gap: 10px;
          }

          .attendance-reason-list-icon {
            width: 40px;
            height: 40px;
          }

          .attendance-reason-edit-row input {
            font-size: 13px;
          }

          .attendance-reason-row-actions button {
            width: 36px;
            height: 36px;
            flex-basis: 36px;
          }

          .tenant-logo-preview {
            width: 96px;
            height: 96px;
            border-radius: 24px;
          }

          .settings-confirm-backdrop {
            padding:
              max(10px, env(safe-area-inset-top))
              max(10px, env(safe-area-inset-right))
              max(10px, env(safe-area-inset-bottom))
              max(10px, env(safe-area-inset-left));
          }

          .settings-confirm-card {
            width: min(100%, calc(100vw - 20px));
            border-radius: 20px;
          }

          .settings-confirm-header {
            padding: 16px 15px 14px;
          }

          .settings-confirm-body,
          .settings-confirm-actions {
            padding-left: 15px;
            padding-right: 15px;
          }
        }

        @media (hover: none), (pointer: coarse) {
          .platform-branding-refresh,
          .payroll-branding-refresh,
          .attendance-settings-refresh,
          .tenant-branding-refresh {
            min-width: 44px;
            min-height: 44px;
          }

          .attendance-reason-row-actions button {
            min-width: 38px;
            min-height: 38px;
          }

          .platform-brand-actions button,
          .payroll-brand-actions button,
          .tenant-brand-actions button,
          .attendance-settings-actions button,
          .attendance-reason-list-footer button {
            min-height: 46px;
          }

          .platform-logo-dropzone:hover:not(.is-disabled),
          .payroll-logo-dropzone:hover:not(.is-disabled),
          .tenant-logo-dropzone:hover:not(.is-disabled),
          .platform-branding-refresh:hover:not(:disabled),
          .payroll-branding-refresh:hover:not(:disabled),
          .attendance-settings-refresh:hover:not(:disabled),
          .tenant-branding-refresh:hover:not(:disabled) {
            transform: none;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .settings-branding-page *,
          .settings-branding-page *::before,
          .settings-branding-page *::after {
            scroll-behavior: auto !important;
            animation-duration: .01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: .01ms !important;
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
              onClick={() => loadPlatformBranding({ silent: true })}
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

                <SettingsInlineMessage
                  message={platformMessage}
                  type="success"
                  title="YourComate Branding"
                  onClose={() => setPlatformMessage('')}
                />

                <SettingsInlineMessage
                  message={platformError}
                  type="error"
                  title="YourComate Branding"
                  onClose={() => setPlatformError('')}
                />
              </form>
            </div>
          )}
        </section>

      )}

      <section className="payroll-branding-panel">
        <div className="payroll-branding-heading">
          <div>
            <span className="payroll-branding-kicker">
              <Building2 size={15} /> Payroll Branding
            </span>
            <h1>Organisation Payslip Identity</h1>
            <p>
              Set the logo used on payroll documents for each organisation. Payslips
              automatically use the employee&apos;s organisation; HR never needs to
              choose the organisation while processing monthly payroll.
            </p>
          </div>

          {hasPayrollBrandingManagerRole && (
            <button
              type="button"
              className="payroll-branding-refresh"
              onClick={() => loadPayrollBrandingProfiles({ silent: true })}
              disabled={payrollBrandingBusy}
              title="Refresh payroll branding"
              aria-label="Refresh payroll branding"
            >
              <RefreshCw
                size={18}
                className={payrollBrandingLoading ? 'tenant-brand-spin' : ''}
              />
            </button>
          )}
        </div>

        {!hasPayrollBrandingManagerRole ? (
          <div className="payroll-brand-permission">
            <ShieldCheck size={19} />
            Payroll branding is available to tenant HR and administrators who manage
            payroll configuration.
          </div>
        ) : payrollBrandingLoading ? (
          <div className="payroll-brand-loading">
            <LoaderCircle size={21} className="tenant-brand-spin" />
            Loading organisation payroll branding...
          </div>
        ) : payrollBrandingError && !payrollProfiles.length ? (
          <SettingsInlineMessage
            message={payrollBrandingError}
            type="error"
            title="Payroll Branding"
            onClose={() => setPayrollBrandingError('')}
          />
        ) : (
          <>
            {payrollProfiles.length > 0 && (
              <div className="payroll-organisation-selector">
                <div className="payroll-organisation-selector-copy">
                  <span>
                    {payrollSelectionMode === 'multiple'
                      ? `${payrollOrganisationCount} organisations available`
                      : 'Payroll organisation'}
                  </span>
                  <strong>
                    {payrollSelectionMode === 'multiple'
                      ? 'Choose which organisation you want to configure.'
                      : safeText(
                          selectedPayrollProfile?.organisation_name ||
                            selectedPayrollProfile?.organization_name,
                          branding.companyName,
                        )}
                  </strong>
                </div>

                {payrollSelectionMode === 'multiple' && (
                  <select
                    className="payroll-organisation-select"
                    value={selectedPayrollProfileKey}
                    onChange={handlePayrollProfileChange}
                    disabled={payrollBrandingBusy}
                    aria-label="Select payroll organisation"
                  >
                    {payrollProfiles.map((profile) => {
                      const reference = getPayrollProfileReference(profile);
                      const name = safeText(
                        profile.organisation_name || profile.organization_name,
                        'Organisation',
                      );
                      const code = safeText(
                        profile.organisation_code || profile.organization_code,
                      );

                      return (
                        <option key={reference} value={reference}>
                          {name}{code ? ` (${code})` : ''}
                        </option>
                      );
                    })}
                  </select>
                )}
              </div>
            )}

            {selectedPayrollProfile ? (
              <div className="payroll-branding-layout">
                <div className="payroll-brand-preview">
                  <div className="payroll-brand-preview-card">
                    <div className="payroll-logo-preview">
                      {previewPayrollLogoUrl ? (
                        <img
                          src={previewPayrollLogoUrl}
                          alt={`${safeText(
                            selectedPayrollProfile.organisation_name ||
                              selectedPayrollProfile.organization_name,
                            'Organisation',
                          )} payroll logo`}
                          onError={(event) => {
                            event.currentTarget.style.display = 'none';
                          }}
                        />
                      ) : (
                        safeText(
                          selectedPayrollProfile.organisation_name ||
                            selectedPayrollProfile.organization_name,
                          branding.companyName,
                        )
                          .split(/\s+/)
                          .map((word) => word[0])
                          .join('')
                          .slice(0, 3)
                          .toUpperCase()
                      )}
                    </div>

                    <h2>
                      {safeText(
                        selectedPayrollProfile.organisation_name ||
                          selectedPayrollProfile.organization_name,
                        branding.companyName,
                      )}
                    </h2>
                    {selectedPayrollProfile.address && (
                      <p>{selectedPayrollProfile.address}</p>
                    )}

                    <div className="payroll-brand-preview-divider" />
                    <p className="payroll-brand-preview-title">Payslip</p>

                    <div className="payroll-brand-status-grid">
                      <div className="payroll-brand-status-item">
                        <span>Logo source</span>
                        <strong>
                          {getPayrollLogoSourceLabel(selectedPayrollProfile.logo_source)}
                        </strong>
                      </div>
                      <div className="payroll-brand-status-item">
                        <span>Active design</span>
                        <strong>
                          {selectedPayrollProfile.has_active_custom_design
                            ? `Custom v${selectedPayrollProfile.active_version || 1}`
                            : 'System default'}
                        </strong>
                      </div>
                      <div className="payroll-brand-status-item">
                        <span>Designer draft</span>
                        <strong>
                          {selectedPayrollProfile.has_draft
                            ? `Draft v${selectedPayrollProfile.draft_version || 1}`
                            : 'No pending draft'}
                        </strong>
                      </div>
                      <div className="payroll-brand-status-item">
                        <span>Payroll mapping</span>
                        <strong>Automatic by employee organisation</strong>
                      </div>
                    </div>
                  </div>
                </div>

                <form className="payroll-brand-editor" onSubmit={uploadPayrollLogo}>
                  <h2>
                    <ImagePlus size={21} /> Payroll Logo
                  </h2>
                  <p>
                    Upload a dedicated payroll logo for this organisation. If you do
                    not upload one, payroll automatically falls back to the
                    organisation logo, then the tenant company logo, then initials.
                  </p>

                  <label
                    className={`payroll-logo-dropzone${
                      payrollBrandingBusy ? ' is-disabled' : ''
                    }`}
                  >
                    <span className="payroll-logo-dropzone-icon">
                      <UploadCloud size={23} />
                    </span>
                    <span>
                      <strong>
                        {selectedPayrollLogoFile
                          ? 'Choose a different payroll logo'
                          : 'Select payroll logo'}
                      </strong>
                      <span>JPG, JPEG, PNG, or WEBP · Maximum 3 MB</span>
                    </span>
                    <input
                      ref={payrollLogoInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                      onChange={handlePayrollLogoFileChange}
                      disabled={payrollBrandingBusy}
                    />
                  </label>

                  {selectedPayrollLogoFile && (
                    <div className="payroll-logo-file-meta">
                      <CheckCircle2 size={17} />
                      <span>
                        {selectedPayrollLogoFile.name} ·{' '}
                        {formatFileSize(selectedPayrollLogoFile.size)}
                      </span>
                    </div>
                  )}

                  <div className="payroll-brand-actions">
                    <button
                      type="submit"
                      className="payroll-logo-save"
                      disabled={!selectedPayrollLogoFile || payrollBrandingBusy}
                    >
                      {payrollLogoSaving ? (
                        <LoaderCircle size={17} className="tenant-brand-spin" />
                      ) : (
                        <UploadCloud size={17} />
                      )}
                      {payrollLogoSaving ? 'Uploading...' : 'Upload Payroll Logo'}
                    </button>

                    <button
                      type="button"
                      className="payroll-logo-remove"
                      onClick={removePayrollLogo}
                      disabled={
                        !selectedPayrollProfile.has_custom_payroll_logo ||
                        payrollBrandingBusy
                      }
                    >
                      <Trash2 size={17} />
                      Remove Custom Logo
                    </button>

                    <button
                      type="button"
                      className="payroll-designer-open"
                      onClick={openPayslipDesigner}
                      disabled={payrollBrandingBusy}
                    >
                      <Type size={17} />
                      Open Payslip Designer
                    </button>
                  </div>

                  <div className="payroll-brand-note">
                    The organisation name is fetched from the employee&apos;s organisation
                    master record. This setting controls payroll presentation only; it
                    never changes salary calculations, statutory deductions, or payroll
                    approval data.
                  </div>

                  <SettingsInlineMessage
                    message={payrollBrandingMessage}
                    type="success"
                    title="Payroll Branding"
                    onClose={() => setPayrollBrandingMessage('')}
                  />

                  <SettingsInlineMessage
                    message={payrollBrandingError}
                    type="error"
                    title="Payroll Branding"
                    onClose={() => setPayrollBrandingError('')}
                  />
                </form>
              </div>
            ) : (
              <div className="payroll-brand-permission">
                No organisation is currently available for payroll branding.
              </div>
            )}
          </>
        )}
      </section>

      <section className="attendance-settings-panel">
        <div className="attendance-settings-heading">
          <div>
            <span className="attendance-settings-kicker">
              <Clock size={15} /> Tenant Attendance Schedule
            </span>
            <h1>Attendance Timings</h1>
            <p>
              Set the attendance timings for {branding.companyName}. The existing
              check-in and checkout workflow remains unchanged; employees simply
              follow the schedule configured by their own tenant HR/Admin.
            </p>
          </div>

          <button
            type="button"
            className="attendance-settings-refresh"
            onClick={() => loadAttendanceSchedule({ silent: true })}
            disabled={attendanceScheduleBusy}
            title="Refresh attendance timings"
            aria-label="Refresh attendance timings"
          >
            <RefreshCw
              size={18}
              className={attendanceScheduleLoading ? 'tenant-brand-spin' : ''}
            />
          </button>
        </div>

        {attendanceScheduleLoading ? (
          <div className="attendance-settings-loading">
            <span>
              <LoaderCircle size={21} className="tenant-brand-spin" />
              Loading tenant attendance timings...
            </span>
          </div>
        ) : (
          <form className="attendance-settings-form" onSubmit={saveAttendanceSchedule}>
            <div className="attendance-settings-meta">
              <span>
                These timings are isolated to this tenant only.
                {attendanceScheduleUpdatedAt && (
                  <>
                    {' '}Last updated {formatSettingsTimestamp(attendanceScheduleUpdatedAt)}
                    {attendanceScheduleUpdatedBy
                      ? ` by ${attendanceScheduleUpdatedBy}`
                      : ''}.
                  </>
                )}
              </span>
              <span className="attendance-settings-source">
                <CheckCircle2 size={14} />
                {attendanceScheduleSource === 'tenant'
                  ? 'Tenant customised'
                  : 'Using defaults'}
              </span>
            </div>

            <div className="attendance-schedule-grid">
              <div className="attendance-time-card">
                <label htmlFor="attendance-check-in-time">Check-in Time</label>
                <p>Normal office attendance start time.</p>
                <input id="attendance-check-in-time" type="time" value={attendanceSchedule.check_in_time}
                  onChange={(event) => updateAttendanceScheduleField('check_in_time', event.target.value)}
                  disabled={!canEditAttendanceSchedule || attendanceScheduleBusy} required />
              </div>

              <div className="attendance-time-card">
                <label htmlFor="attendance-late-cutoff-time">Late After</label>
                <p>Late check-in reason is required from this time onward.</p>
                <input id="attendance-late-cutoff-time" type="time" value={attendanceSchedule.late_cutoff_time}
                  onChange={(event) => updateAttendanceScheduleField('late_cutoff_time', event.target.value)}
                  disabled={!canEditAttendanceSchedule || attendanceScheduleBusy} required />
              </div>

              <div className="attendance-time-card">
                <label htmlFor="attendance-break-start-time">Break Start</label>
                <p>Tenant's scheduled break starting time.</p>
                <input id="attendance-break-start-time" type="time" value={attendanceSchedule.break_start_time}
                  onChange={(event) => updateAttendanceScheduleField('break_start_time', event.target.value)}
                  disabled={!canEditAttendanceSchedule || attendanceScheduleBusy} required />
              </div>

              <div className="attendance-time-card">
                <label htmlFor="attendance-break-end-time">Break End</label>
                <p>Tenant's scheduled break ending time.</p>
                <input id="attendance-break-end-time" type="time" value={attendanceSchedule.break_end_time}
                  onChange={(event) => updateAttendanceScheduleField('break_end_time', event.target.value)}
                  disabled={!canEditAttendanceSchedule || attendanceScheduleBusy} required />
              </div>

              <div className="attendance-time-card">
                <label htmlFor="attendance-check-out-time">Checkout Time</label>
                <p>Normal office attendance ending time.</p>
                <input id="attendance-check-out-time" type="time" value={attendanceSchedule.check_out_time}
                  onChange={(event) => updateAttendanceScheduleField('check_out_time', event.target.value)}
                  disabled={!canEditAttendanceSchedule || attendanceScheduleBusy} required />
              </div>
            </div>

            <div className="attendance-time-preview">
              <Clock size={16} />
              <strong>{formatAttendanceTime(attendanceSchedule.check_in_time)}</strong><span>Check-in</span>
              <span>•</span>
              <strong>{formatAttendanceTime(attendanceSchedule.late_cutoff_time)}</strong><span>Late after</span>
              <span>•</span>
              <strong>{formatAttendanceTime(attendanceSchedule.break_start_time)} – {formatAttendanceTime(attendanceSchedule.break_end_time)}</strong><span>Break</span>
              <span>•</span>
              <strong>{formatAttendanceTime(attendanceSchedule.check_out_time)}</strong><span>Checkout</span>
            </div>

            {!canEditAttendanceSchedule && (
              <div className="attendance-reason-permission">
                <ShieldCheck size={19} />
                Only this tenant's HR/Admin can change attendance timings. Other tenants and companies are not affected.
              </div>
            )}

            {canEditAttendanceSchedule && (
              <div className="attendance-settings-actions">
                <button type="button" className="attendance-reasons-reset"
                  onClick={restoreDefaultAttendanceSchedule} disabled={attendanceScheduleBusy}>
                  <RotateCcw size={17} /> Restore Defaults
                </button>
                <button type="submit" className="attendance-reasons-save" disabled={attendanceScheduleBusy}>
                  {attendanceScheduleSaving ? (
                    <LoaderCircle size={17} className="tenant-brand-spin" />
                  ) : (
                    <Save size={17} />
                  )}
                  {attendanceScheduleSaving ? 'Saving Attendance Timings...' : 'Save Attendance Timings'}
                </button>
              </div>
            )}

            <SettingsInlineMessage
              message={attendanceScheduleMessage}
              type="success"
              title="Attendance Timings"
              onClose={() => setAttendanceScheduleMessage('')}
            />

            <SettingsInlineMessage
              message={attendanceScheduleError}
              type="error"
              title="Attendance Timings"
              onClose={() => setAttendanceScheduleError('')}
            />
          </form>
        )}
      </section>

      <section className="attendance-settings-panel">
        <div className="attendance-settings-heading">
          <div>
            <span className="attendance-settings-kicker">
              <Clock size={15} /> Attendance Rules
            </span>
            <h1>Late and Early Checkout Reasons</h1>
            <p>
              Manage the dropdown reasons employees see for late check-in from{' '}
              {formatAttendanceTime(attendanceSchedule.late_cutoff_time)} and early
              checkout before {formatAttendanceTime(attendanceSchedule.check_out_time)}.
              These settings apply only to {branding.companyName}.
            </p>
          </div>

          <button
            type="button"
            className="attendance-settings-refresh"
            onClick={() => loadAttendanceReasonSettings({ silent: true })}
            disabled={attendanceReasonsBusy}
            title="Refresh attendance reasons"
            aria-label="Refresh attendance reasons"
          >
            <RefreshCw
              size={18}
              className={attendanceReasonsLoading ? 'tenant-brand-spin' : ''}
            />
          </button>
        </div>

        {attendanceReasonsLoading ? (
          <div className="attendance-settings-loading">
            <span>
              <LoaderCircle size={21} className="tenant-brand-spin" />
              Loading tenant attendance reasons...
            </span>
          </div>
        ) : (
          <form className="attendance-settings-form" onSubmit={saveAttendanceReasons}>
            <div className="attendance-settings-meta">
              <span>
                Employees receive these lists automatically from their tenant
                attendance settings.
                {attendanceReasonUpdatedAt && (
                  <>
                    {' '}Last updated {formatSettingsTimestamp(attendanceReasonUpdatedAt)}
                    {attendanceReasonUpdatedBy
                      ? ` by ${attendanceReasonUpdatedBy}`
                      : ''}.
                  </>
                )}
              </span>
              <span className="attendance-settings-source">
                <CheckCircle2 size={14} />
                {attendanceReasonSource === 'tenant'
                  ? 'Tenant customised'
                  : 'Using defaults'}
              </span>
            </div>

            <div className="attendance-reason-editor-grid">
              <AttendanceReasonListEditor
                title="Late Check-in Reasons"
                description={`Displayed when an employee checks in at or after ${formatAttendanceTime(attendanceSchedule.late_cutoff_time)}.`}
                icon={LogIn}
                options={lateReasons}
                disabled={!canEditAttendanceReasons || attendanceReasonsBusy}
                onAdd={() => addAttendanceReason(setLateReasons)}
                onChange={(index, value) =>
                  updateAttendanceReason(setLateReasons, index, value)
                }
                onMove={(fromIndex, toIndex) =>
                  moveAttendanceReason(setLateReasons, fromIndex, toIndex)
                }
                onRemove={(index) =>
                  removeAttendanceReason(setLateReasons, index)
                }
              />

              <AttendanceReasonListEditor
                title="Early Checkout Reasons"
                description={`Displayed when an employee checks out before ${formatAttendanceTime(attendanceSchedule.check_out_time)}.`}
                icon={LogOut}
                options={earlyCheckoutReasons}
                disabled={!canEditAttendanceReasons || attendanceReasonsBusy}
                onAdd={() => addAttendanceReason(setEarlyCheckoutReasons)}
                onChange={(index, value) =>
                  updateAttendanceReason(setEarlyCheckoutReasons, index, value)
                }
                onMove={(fromIndex, toIndex) =>
                  moveAttendanceReason(
                    setEarlyCheckoutReasons,
                    fromIndex,
                    toIndex,
                  )
                }
                onRemove={(index) =>
                  removeAttendanceReason(setEarlyCheckoutReasons, index)
                }
              />
            </div>

            {!canEditAttendanceReasons && (
              <div className="attendance-reason-permission">
                <ShieldCheck size={19} />
                Only the tenant HR/Admin can add, rename, reorder, remove or save
                attendance reasons. Other is fixed because employees must write a
                complete explanation when they select it.
              </div>
            )}

            {canEditAttendanceReasons && (
              <div className="attendance-settings-actions">
                <button
                  type="button"
                  className="attendance-reasons-reset"
                  onClick={restoreDefaultAttendanceReasons}
                  disabled={attendanceReasonsBusy}
                >
                  <RotateCcw size={17} /> Restore Defaults
                </button>
                <button
                  type="submit"
                  className="attendance-reasons-save"
                  disabled={attendanceReasonsBusy}
                >
                  {attendanceReasonsSaving ? (
                    <LoaderCircle size={17} className="tenant-brand-spin" />
                  ) : (
                    <Save size={17} />
                  )}
                  {attendanceReasonsSaving
                    ? 'Saving Attendance Reasons...'
                    : 'Save Attendance Reasons'}
                </button>
              </div>
            )}

            <SettingsInlineMessage
              message={attendanceReasonMessage}
              type="success"
              title="Attendance Reasons"
              onClose={() => setAttendanceReasonMessage('')}
            />

            <SettingsInlineMessage
              message={attendanceReasonError}
              type="error"
              title="Attendance Reasons"
              onClose={() => setAttendanceReasonError('')}
            />
          </form>
        )}
      </section>

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
            onClick={() => loadBranding({ silent: true })}
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

              <SettingsInlineMessage
                message={message}
                type="success"
                title="Company Branding"
                onClose={() => setMessage('')}
              />

              <SettingsInlineMessage
                message={error}
                type="error"
                title="Company Branding"
                onClose={() => setError('')}
              />
            </form>
          </div>
        )}
      </section>


      <SettingsConfirmPopup popup={confirmPopup} onResolve={resolveConfirm} />
    </div>
  );
}