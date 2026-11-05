import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  buildAttendancePayload,
  createHolidayWorkRequest,
  getAttendanceStatus,
  getCurrentLocation,
  submitCheckIn,
  submitCheckOut,
} from '../api/client';
import { useCustomAlert } from './CustomAlertProvider.jsx';
import {
  getSprintAvailability,
  getSprintCheckoutTasks,
  getDailyCheckoutReadiness,
  reportDailyActivity,
  uploadCheckoutEvidence,
  prepareDailyActivityTemplate,
  uploadSprintAttachment,
} from '../api/sprintPlanning';


const HOLD_DURATION = 1600;
const OTHER_REASON_CODE = 'other';
const DEFAULT_OTHER_REASON_MIN_LENGTH = 12;
const DEFAULT_OTHER_REASON_MAX_LENGTH = 300;

const DEFAULT_LATE_REASON_OPTIONS = [
  { code: 'traffic_congestion', label: 'Traffic congestion' },
  { code: 'public_transport_delay', label: 'Public transport delay' },
  { code: 'vehicle_breakdown', label: 'Vehicle breakdown' },
  { code: 'bad_weather', label: 'Bad weather or heavy rain' },
  { code: 'medical_issue', label: 'Medical or health issue' },
  { code: 'family_emergency', label: 'Family emergency' },
  { code: 'official_duty', label: 'Official work or field duty' },
  { code: OTHER_REASON_CODE, label: 'Other', requires_details: true },
];

const DEFAULT_EARLY_CHECKOUT_REASON_OPTIONS = [
  { code: 'medical_appointment', label: 'Medical appointment' },
  { code: 'health_issue', label: 'Health issue' },
  { code: 'family_emergency', label: 'Family emergency' },
  { code: 'personal_emergency', label: 'Personal emergency' },
  { code: 'official_duty', label: 'Official work or field visit' },
  { code: 'transport_issue', label: 'Transport issue' },
  { code: 'manager_approval', label: 'Approved by manager or HR' },
  { code: OTHER_REASON_CODE, label: 'Other', requires_details: true },
];

const OBVIOUS_REASON_PLACEHOLDERS = new Set([
  'abc',
  'dummy',
  'gibberish',
  'hello',
  'ipsum',
  'lorem',
  'na',
  'nil',
  'none',
  'null',
  'random',
  'reason',
  'sample',
  'something',
  'test',
  'testing',
  'unknown',
  'xyz',
]);

const OBVIOUS_KEYBOARD_SEQUENCES = [
  'qwerty',
  'qwer',
  'asdf',
  'zxcv',
  'hjkl',
  'dfgh',
  'abcdef',
  '123456',
];


function normalizeReasonOptions(values, fallbackOptions) {
  const source = Array.isArray(values) && values.length ? values : fallbackOptions;
  const options = [];
  const usedCodes = new Set();

  source.forEach((item) => {
    const code = String(item?.code || '').trim().toLowerCase();
    const label = String(item?.label || '').trim();

    if (!code || !label || usedCodes.has(code)) {
      return;
    }

    usedCodes.add(code);
    options.push({
      code,
      label,
      requires_details:
        code === OTHER_REASON_CODE || Boolean(item?.requires_details),
    });
  });

  if (!usedCodes.has(OTHER_REASON_CODE)) {
    options.push({
      code: OTHER_REASON_CODE,
      label: 'Other',
      requires_details: true,
    });
  }

  return options.length ? options : fallbackOptions;
}

function normalizedReasonLimits(reasonSettings = {}) {
  const configuredMin = Number(reasonSettings.other_reason_min_length);
  const configuredMax = Number(reasonSettings.other_reason_max_length);

  const minLength = Number.isFinite(configuredMin) && configuredMin >= 1
    ? Math.floor(configuredMin)
    : DEFAULT_OTHER_REASON_MIN_LENGTH;
  const maxLength = Number.isFinite(configuredMax) && configuredMax >= minLength
    ? Math.floor(configuredMax)
    : DEFAULT_OTHER_REASON_MAX_LENGTH;

  return { minLength, maxLength };
}

function meaningfulOtherReasonError(
  value,
  reasonLabel,
  minLength = DEFAULT_OTHER_REASON_MIN_LENGTH,
  maxLength = DEFAULT_OTHER_REASON_MAX_LENGTH,
) {
  const reason = String(value || '').trim().replace(/\s+/g, ' ');
  const validationMessage =
    `Enter a meaningful ${reasonLabel} using at least ${minLength} characters ` +
    'and 2 words. A single dot, symbols, placeholder text, and gibberish are not accepted.';

  if (reason.length < minLength || reason.length > maxLength) {
    return validationMessage;
  }

  const words = reason.toLocaleLowerCase().match(/\p{L}{2,}/gu) || [];
  const letters = reason.toLocaleLowerCase().match(/\p{L}/gu) || [];
  const compact = reason
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');

  if (words.length < 2 || letters.length < 8 || new Set(letters).size < 4) {
    return validationMessage;
  }

  if (new Set(words).size === 1) {
    return validationMessage;
  }

  if (words.every((word) => OBVIOUS_REASON_PLACEHOLDERS.has(word))) {
    return validationMessage;
  }

  if (OBVIOUS_KEYBOARD_SEQUENCES.some((sequence) => compact.includes(sequence))) {
    return validationMessage;
  }

  if (
    words.every(
      (word) => word.length >= 4 && new Set(Array.from(word)).size <= 2,
    )
  ) {
    return validationMessage;
  }

  return '';
}

function selectedReasonPayload(prefix, code, customReason, options) {
  const selectedOption = options.find((option) => option.code === code);
  const isOther = code === OTHER_REASON_CODE;

  return {
    [`${prefix}_reason_code`]: code || '',
    [`${prefix}_reason`]: isOther
      ? 'Other'
      : String(selectedOption?.label || '').trim(),
    [`${prefix}_reason_detail`]: isOther
      ? String(customReason || '').trim().replace(/\s+/g, ' ')
      : '',
  };
}


function formatTodayLabel() {
  return new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function scheduleTimeParts(value, fallback = '') {
  const raw = String(value || fallback || '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);

  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  return { hours, minutes };
}

function isAtOrAfterScheduleTime(value, fallback) {
  const target = scheduleTimeParts(value, fallback);

  if (!target) {
    return false;
  }

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const targetMinutes = target.hours * 60 + target.minutes;

  return currentMinutes >= targetMinutes;
}

function isBeforeScheduleTime(value, fallback) {
  const target = scheduleTimeParts(value, fallback);

  if (!target) {
    return false;
  }

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const targetMinutes = target.hours * 60 + target.minutes;

  return currentMinutes < targetMinutes;
}

function formatScheduleTime(value, fallback = '--') {
  const target = scheduleTimeParts(value);

  if (!target) {
    return fallback;
  }

  const meridiem = target.hours >= 12 ? 'PM' : 'AM';
  const displayHour = target.hours % 12 || 12;

  return `${String(displayHour).padStart(2, '0')}:${String(target.minutes).padStart(2, '0')} ${meridiem}`;
}

function modeLabel(mode) {
  if (mode === 'wfh') return 'Work From Home';
  if (mode === 'field') return 'Field';
  if (mode === 'office') return 'Office';
  return mode || 'Office';
}

function statusLabel(value) {
  if (!value) return 'Pending';

  return String(value)
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function attendanceErrorMessage(error) {
  const rawMessage = String(error?.message || '').trim();

  if (!rawMessage) {
    return 'Attendance update failed. Please try again.';
  }

  const lowerMessage = rawMessage.toLowerCase();

  if (
    lowerMessage.includes('location') ||
    lowerMessage.includes('gps')
  ) {
    return `${rawMessage} Please allow browser location permission and try again.`;
  }

  return rawMessage;
}


function formatTime(value) {
  if (!value) return '--';

  try {
    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
      return '--';
    }

    return parsed.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '--';
  }
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function gpsStatusText(location) {
  if (!location?.latitude || !location?.longitude) {
    return '';
  }

  const accuracy = Number(location.accuracy || 0);

  if (accuracy > 0) {
    return `GPS ready • Accuracy ±${Math.round(accuracy)}m`;
  }

  return 'GPS ready';
}

function previewFile(file, setter) {
  if (!file) {
    setter('');
    return;
  }

  setter(URL.createObjectURL(file));
}


function HoldButton({
  type = 'button',
  label,
  loadingLabel,
  loading,
  disabled,
  onComplete,
  variant = 'primary',
}) {
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const timerRef = useRef(null);
  const intervalRef = useRef(null);
  const startRef = useRef(0);
  const completedRef = useRef(false);

  function clearHold() {
    setHolding(false);
    setProgress(0);
    completedRef.current = false;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  function startHold(event) {
    if (event?.cancelable) {
      event.preventDefault();
    }

    if (disabled || loading || holding) {
      return;
    }

    completedRef.current = false;
    setHolding(true);
    setProgress(0);
    startRef.current = Date.now();

    intervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startRef.current;
      const nextProgress = Math.min((elapsed / HOLD_DURATION) * 100, 100);
      setProgress(nextProgress);
    }, 30);

    timerRef.current = setTimeout(() => {
      completedRef.current = true;

      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }

      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      setHolding(false);
      setProgress(100);

      if (typeof onComplete === 'function') {
        onComplete();
      }

      setTimeout(() => {
        setProgress(0);
        completedRef.current = false;
      }, 250);
    }, HOLD_DURATION);
  }

  function stopHold() {
    if (completedRef.current) {
      return;
    }

    clearHold();
  }

  useEffect(() => {
    return () => clearHold();
  }, []);

  return (
    <button
      type={type}
      className={`hold-btn ${variant} ${holding ? 'holding' : ''}`}
      onMouseDown={startHold}
      onMouseUp={stopHold}
      onMouseLeave={stopHold}
      onTouchStart={startHold}
      onTouchEnd={stopHold}
      onTouchCancel={stopHold}
      disabled={disabled || loading}
      aria-label={label}
      style={{ '--hold-progress': `${progress}%` }}
    >
      <span className="hold-progress" />

      <span className="hold-ring">
        <span className="hold-ring-inner">
          {loading ? '...' : holding ? `${Math.round(progress)}%` : '⏱'}
        </span>
      </span>

      <span className="hold-text">
        {loading ? loadingLabel : holding ? 'Keep holding...' : label}
      </span>
    </button>
  );
}


// The backend supplies approved, tenant-scoped tasks for its attendance-local
// date. Existing daily reports are prefilled so employees never retype them.
function sprintCheckoutDraft(item) {
  const evidence = Array.isArray(item.evidence) ? item.evidence : [];
  const link = evidence.find((entry) => entry?.type === 'link');
  return {
    ...item,
    key: `${item.plan_id}:${item.activity_id}`,
    status: ['completed', 'in_progress', 'not_completed'].includes(item.status)
      ? item.status : '',
    incomplete_reason: String(item.incomplete_reason || ''),
    remarks: String(item.remarks || ''),
    evidence,
    evidenceUrl: String(link?.reference || ''),
    evidenceFile: null,
    customValues: { ...(item.daily_custom_values || {}) },
    customFiles: {},
    dirty: false,
  };
}

function sprintReportIsComplete(item) {
  if (item.status === 'completed') {
    return Boolean(
      (item.evidence || []).some((entry) => entry?.type !== 'link') ||
      item.evidenceUrl.trim() || item.evidenceFile ||
      Object.values(item.customFiles || {}).some(Boolean)
    );
  }
  return ['in_progress', 'not_completed'].includes(item.status) &&
    item.incomplete_reason.trim().length >= 10;
}

function sprintEvidenceType(file) {
  return String(file?.type || '').startsWith('image/') ? 'photo' : 'document';
}

function sprintValidationMessage(item) {
  const label = item.title || 'Activity';
  if (!item.status) return `${label}: choose the actual work status.`;
  if (!sprintReportIsComplete(item)) {
    return item.status === 'completed'
      ? `${label}: add evidence (a URL, document or photo).`
      : `${label}: explain unfinished work in at least 10 characters.`;
  }
  if (item.evidenceUrl.trim() &&
      !/^https?:\/\/\S+$/i.test(item.evidenceUrl.trim())) {
    return `${label}: evidence URL must begin with https:// or http://.`;
  }
  for (const column of item.daily_columns || []) {
    const value = item.customValues?.[column.key];
    if (column.required && !item.customFiles?.[column.key] &&
        (value === null || value === undefined || value === '')) {
      return `${label}: ${column.label} is required by the daily report template.`;
    }
  }
  return '';
}

export default function AttendanceWidget({ onSuccess }) {
  const alerts = useCustomAlert();

  const [mode, setMode] = useState('office');
  const [fieldLocation, setFieldLocation] = useState('');
  const [fieldPhotoFile, setFieldPhotoFile] = useState(null);
  const [fieldPhotoPreview, setFieldPhotoPreview] = useState('');
  const [lateReasonCode, setLateReasonCode] = useState('');
  const [lateOtherReason, setLateOtherReason] = useState('');
  const [earlyCheckoutReasonCode, setEarlyCheckoutReasonCode] = useState('');
  const [earlyCheckoutOtherReason, setEarlyCheckoutOtherReason] = useState('');
  const [sprintCheckout, setSprintCheckout] = useState(null);



  const [holidayRequestDate, setHolidayRequestDate] = useState(todayISO());
  const [holidayReason, setHolidayReason] = useState('');
  const [holidayWorkLocation, setHolidayWorkLocation] = useState('');
  const [holidayPhotoFile, setHolidayPhotoFile] = useState(null);
  const [holidayPhotoPreview, setHolidayPhotoPreview] = useState('');
  const [showHolidayRequestForm, setShowHolidayRequestForm] = useState(false);

  const [statusData, setStatusData] = useState(null);
  const [loadingType, setLoadingType] = useState('');
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [currentGps, setCurrentGps] = useState(null);

  const attendance = statusData?.attendance || null;
  const holiday = statusData?.holiday || {};
  const availableModes = statusData?.available_modes || ['office', 'wfh', 'field'];
  const holidayWorkRequest = statusData?.holiday_work_request || null;
  const holidayWorkApproved = Boolean(statusData?.holiday_work_approved);
  const holidayCheckInBlocked = Boolean(statusData?.holiday_check_in_blocked);
  const compOffs = statusData?.compoffs || [];
  const employee = statusData?.employee || statusData?.employee_summary || {};
  const reasonSettings = statusData?.reason_settings || {};

  const checkedIn = Boolean(attendance?.check_in);
  const checkedOut = Boolean(attendance?.check_out);

  const officeStart =
    statusData?.office_start ||
    statusData?.attendance_schedule?.check_in_time ||
    '09:30';
  const lateCutoff =
    statusData?.late_cutoff ||
    statusData?.attendance_schedule?.late_cutoff_time ||
    '09:50';
  const breakStart =
    statusData?.break_start ||
    statusData?.attendance_schedule?.break_start_time ||
    '13:00';
  const breakEnd =
    statusData?.break_end ||
    statusData?.attendance_schedule?.break_end_time ||
    '14:00';
  const officeEnd =
    statusData?.office_end ||
    statusData?.attendance_schedule?.check_out_time ||
    '18:00';

  const lateNow = isAtOrAfterScheduleTime(lateCutoff, '09:50');
  const earlyCheckoutNow = isBeforeScheduleTime(officeEnd, '18:00');

  const todayLabel = useMemo(() => formatTodayLabel(), []);
  const availableCompOffCount = compOffs.filter((item) => item.status === 'available').length;
  const lateReasonOptions = useMemo(
    () => normalizeReasonOptions(
      reasonSettings.late_reasons,
      DEFAULT_LATE_REASON_OPTIONS,
    ),
    [reasonSettings.late_reasons],
  );
  const earlyCheckoutReasonOptions = useMemo(
    () => normalizeReasonOptions(
      reasonSettings.early_checkout_reasons,
      DEFAULT_EARLY_CHECKOUT_REASON_OPTIONS,
    ),
    [reasonSettings.early_checkout_reasons],
  );
  const { minLength: otherReasonMinLength, maxLength: otherReasonMaxLength } =
    useMemo(
      () => normalizedReasonLimits(reasonSettings),
      [
        reasonSettings.other_reason_min_length,
        reasonSettings.other_reason_max_length,
      ],
    );

  const lateOtherReasonError = lateReasonCode === OTHER_REASON_CODE
    ? meaningfulOtherReasonError(
      lateOtherReason,
      'late check-in reason',
      otherReasonMinLength,
      otherReasonMaxLength,
    )
    : '';
  const earlyCheckoutOtherReasonError =
    earlyCheckoutReasonCode === OTHER_REASON_CODE
      ? meaningfulOtherReasonError(
        earlyCheckoutOtherReason,
        'early checkout reason',
        otherReasonMinLength,
        otherReasonMaxLength,
      )
      : '';

  const approverText = useMemo(() => {
    const teamLeaderName = employee?.team_leader_name || statusData?.team_leader_name || '';
    const reportingOfficerName =
      employee?.reporting_officer_name || statusData?.reporting_officer_name || '';

    if (teamLeaderName && reportingOfficerName) {
      return `Approval will go to Team Leader ${teamLeaderName}, then Reporting Officer ${reportingOfficerName}.`;
    }

    if (teamLeaderName) {
      return `Approval will go to Team Leader ${teamLeaderName}.`;
    }

    if (reportingOfficerName) {
      return `Approval will go directly to Reporting Officer ${reportingOfficerName}.`;
    }

    return 'Approval will go to HR because Team Leader and Reporting Officer are not mapped.';
  }, [employee, statusData]);

async function loadStatus() {
  try {
    setLoadingStatus(true);

    const data = await getAttendanceStatus();
    setStatusData(data);

    const modes = data?.available_modes || ['office'];

    if (!modes.includes(mode)) {
      setMode(modes[0] || 'office');
    }
  } catch (error) {
    alerts.error(
      error.message || 'Unable to load attendance status',
      'Attendance Status Failed',
    );
  } finally {
    setLoadingStatus(false);
  }
}

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (
      lateReasonCode &&
      !lateReasonOptions.some((option) => option.code === lateReasonCode)
    ) {
      setLateReasonCode('');
      setLateOtherReason('');
    }
  }, [lateReasonCode, lateReasonOptions]);

  useEffect(() => {
    if (
      earlyCheckoutReasonCode &&
      !earlyCheckoutReasonOptions.some(
        (option) => option.code === earlyCheckoutReasonCode,
      )
    ) {
      setEarlyCheckoutReasonCode('');
      setEarlyCheckoutOtherReason('');
    }
  }, [earlyCheckoutReasonCode, earlyCheckoutReasonOptions]);

  async function refreshAfterSuccess() {
    await loadStatus();

    if (typeof onSuccess === 'function') {
      await onSuccess();
    }
  }


function updateSprintCheckoutTask(key, changes) {
  setSprintCheckout((current) => current ? {
    ...current,
    items: current.items.map((item) =>
      item.key === key ? { ...item, ...changes, dirty: true } : item
    ),
  } : current);
}

function updateSprintCustomValue(item, column, value) {
  updateSprintCheckoutTask(item.key, {
    customValues: { ...item.customValues, [column.key]: value },
  });
}

function updateSprintCustomFile(item, column, file) {
  updateSprintCheckoutTask(item.key, {
    customFiles: { ...item.customFiles, [column.key]: file },
  });
}

async function submitSprintReportAndCheckout() {
  if (!sprintCheckout || loadingType) return;
  const { items, workDate, dailyStatus, dailyReason, dailyEvidenceUrl, dailyEvidenceFile } = sprintCheckout;
  if (!['completed', 'not_completed'].includes(dailyStatus)) {
    alerts.warning('Select whether today\'s pending work was completed.', 'Daily Work Status Required');
    return;
  }
  if (dailyStatus === 'not_completed' && String(dailyReason || '').trim().length < 10) {
    alerts.warning('Enter a genuine reason of at least 10 characters.', 'Reason Required');
    return;
  }
  if (dailyStatus === 'completed' && !String(dailyEvidenceUrl || '').trim() && !dailyEvidenceFile) {
    alerts.warning('Add an evidence URL, upload a document, or take a photo.', 'Evidence Required');
    return;
  }
  if (dailyEvidenceUrl?.trim() && !/^https?:\/\/\S+$/i.test(dailyEvidenceUrl.trim())) {
    alerts.warning('Evidence URL must begin with https:// or http://.', 'Invalid Evidence URL');
    return;
  }
  // One daily answer applies only to outstanding activities, never previously reported work.
  // A required custom Sprint template cannot be silently bypassed by the compact form.
  const unresolvedTemplate = items.find((item) => (item.daily_columns || []).some(
    (column) => column.required && !item.customValues?.[column.key]
  ));
  if (unresolvedTemplate) {
    alerts.warning('Your daily plan has required custom fields. Complete those in Sprint Planning before checkout.', 'Sprint Template Fields Required');
    return;
  }
  const reportedItems = items.map((item) => ({
    ...item,
    status: dailyStatus,
    incomplete_reason: dailyStatus === 'not_completed' ? dailyReason.trim() : '',
    evidenceUrl: dailyStatus === 'completed' ? dailyEvidenceUrl.trim() : '',
    evidenceFile: dailyStatus === 'completed' ? dailyEvidenceFile : null,
    // Existing evidence is never reused to claim completion of a new pending activity.
    evidence: [],
    dirty: true,
  }));
  for (const item of reportedItems) {
    const message = sprintValidationMessage(item);
    if (message) {
      alerts.warning(message, 'Daily Work Report Required');
      return;
    }
  }

  setLoadingType('sprint-report');
  try {
    // Save only pending/changed tasks to avoid rewriting valid daily reports.
    for (const item of reportedItems) {
      let evidence = (item.evidence || []).filter((entry) => entry?.type !== 'link');
      if (item.evidenceUrl.trim()) {
        evidence.push({ type: 'link', reference: item.evidenceUrl.trim() });
      }

      const values = { ...(item.customValues || {}) };
      const customFiles = Object.entries(item.customFiles || {}).filter(([, file]) => file);
      if (customFiles.length) {
        await prepareDailyActivityTemplate(item.plan_id, item.activity_id);
        for (const [key, file] of customFiles) {
          const upload = await uploadSprintAttachment({
            planType: 'daily', planId: item.plan_id,
            activityId: item.activity_id, fieldKey: key, file,
          });
          const reference = `sprint-attachment:${upload.attachment_id}`;
          values[key] = reference;
          if (item.status === 'completed') {
            evidence.push({ type: sprintEvidenceType(file), reference });
          }
        }
      }

      if (item.evidenceFile) {
        const upload = await uploadCheckoutEvidence(
          item.plan_id, item.activity_id, item.evidenceFile,
        );
        evidence.push({
          type: sprintEvidenceType(item.evidenceFile),
          reference: upload.reference,
        });
      }

      const payload = {
        status: item.status,
        incomplete_reason: item.status === 'completed'
          ? '' : item.incomplete_reason.trim(),
        evidence,
        remarks: item.remarks,
      };
      if ((item.daily_columns || []).length) {
        payload.daily_custom_values = values;
      }
      await reportDailyActivity(item.plan_id, item.activity_id, payload);
    }

    const readiness = await getDailyCheckoutReadiness(workDate);
    if (!readiness?.ready) {
      throw new Error('The daily report is still incomplete. Refresh the checkout form and try again.');
    }

    setLoadingType('');
    const checkedOutSuccessfully = await submitAttendance('check-out', true);
    if (checkedOutSuccessfully) {
      setSprintCheckout(null);
    }
  } catch (error) {
    alerts.error(
      `${attendanceErrorMessage(error)} Attendance has not been checked out.`,
      'Daily Report / Checkout Failed',
    );
  } finally {
    setLoadingType('');
  }
}

async function refreshGps() {
  try {
    setLoadingType('gps-refresh');
    alerts.info('Refreshing GPS location. Please wait...', 'GPS Refresh');

    const location = await getCurrentLocation();

    setCurrentGps(location);
    alerts.success(gpsStatusText(location) || 'GPS location refreshed.', 'GPS Ready');
  } catch (error) {
    setCurrentGps(null);
    alerts.error(attendanceErrorMessage(error), 'GPS Failed');
  } finally {
    setLoadingType('');
  }
}

function savedGpsPayload() {
  if (!currentGps?.latitude || !currentGps?.longitude) {
    return {};
  }

  return {
    latitude: currentGps.latitude,
    longitude: currentGps.longitude,
    accuracy: currentGps.accuracy || '',
    address: currentGps.address || '',
    location_accuracy_warning: currentGps.location_accuracy_warning || false,
    location_warning: currentGps.location_warning || '',
  };
}


async function submitAttendance(type, sprintReportAlreadySaved = false) {
  if (type === 'check-in') {
    if (checkedIn) {
      alerts.info('You have already checked in today.', 'Already Checked In');
      return;
    }

    if (holidayCheckInBlocked) {
      alerts.warning(
        'Today is a holiday. Please submit a Holiday Work Request and wait for approval before check-in.',
        'Holiday Approval Required',
      );
      setShowHolidayRequestForm(true);
      return;
    }

    if (!availableModes.includes(mode)) {
      alerts.warning(
        `${modeLabel(mode)} check-in is not available for today.`,
        'Check-in Not Available',
      );
      return;
    }

    if (mode === 'field' && !fieldLocation.trim()) {
      alerts.warning(
        'Field location / visit place is required for field check-in.',
        'Field Location Required',
      );
      return;
    }

    if (mode === 'field' && !fieldPhotoFile) {
      alerts.warning(
        'Field photo is required for field check-in.',
        'Field Photo Required',
      );
      return;
    }

    if (lateNow && !holiday?.is_holiday) {
      const selectedLateReason = lateReasonOptions.find(
        (option) => option.code === lateReasonCode,
      );

      if (!selectedLateReason) {
        alerts.warning(
          'Select a late check-in reason from the dropdown.',
          'Late Check-in Reason Required',
        );
        return;
      }

      if (lateReasonCode === OTHER_REASON_CODE && lateOtherReasonError) {
        alerts.warning(lateOtherReasonError, 'Valid Late Reason Required');
        return;
      }
    }
  }

  if (type === 'check-out') {
    if (!checkedIn) {
      alerts.warning('Please check in first before check out.', 'Check In First');
      return;
    }

    if (checkedOut) {
      alerts.info('You have already checked out today.', 'Already Checked Out');
      return;
    }

    if (earlyCheckoutNow && !holiday?.is_holiday) {
      const selectedEarlyCheckoutReason = earlyCheckoutReasonOptions.find(
        (option) => option.code === earlyCheckoutReasonCode,
      );

      if (!selectedEarlyCheckoutReason) {
        alerts.warning(
          'Select an early checkout reason from the dropdown.',
          'Early Checkout Reason Required',
        );
        return;
      }

      if (
        earlyCheckoutReasonCode === OTHER_REASON_CODE &&
        earlyCheckoutOtherReasonError
      ) {
        alerts.warning(
          earlyCheckoutOtherReasonError,
          'Valid Early Checkout Reason Required',
        );
        return;
      }
    }
  }


if (type === 'check-out' && !sprintReportAlreadySaved) {
  try {
    setLoadingType('sprint-checkout');
    // Tenant activation is resolved by the authenticated server, not local storage.
    const availability = await getSprintAvailability();
    if (typeof availability?.enabled !== 'boolean') {
      throw new Error('Unable to verify your organisation\'s Sprint setting.');
    }
    if (availability.enabled) {
      const daily = await getSprintCheckoutTasks();
      if (!daily || typeof daily.ready !== 'boolean' || !Array.isArray(daily.items)) {
        throw new Error('Unable to verify today\'s Sprint work report.');
      }
      if (!daily.ready) {
        if (!daily.items.length) {
          throw new Error('Sprint reporting is required, but today\'s activities could not be loaded.');
        }
        const pending = daily.items.map(sprintCheckoutDraft).filter((item) => !sprintReportIsComplete(item));
        if (!pending.length) {
          throw new Error('Daily reporting is required, but no pending activities were returned.');
        }
        setSprintCheckout({
          workDate: daily.work_date,
          items: pending,
          dailyStatus: '',
          dailyReason: '',
          dailyEvidenceUrl: '',
          dailyEvidenceFile: null,
        });
        return false;
      }
    }
    // Confirmed Sprint-OFF tenants continue normal attendance checkout.
  } catch (error) {
    console.warn('Sprint checkout preflight failed; attendance checkout not attempted:', error);
    alerts.error(
      `${attendanceErrorMessage(error)} Please try again. Attendance has not been checked out.`,
      'Unable to Verify Sprint Report',
    );
    return false;
  } finally {
    setLoadingType('');
  }
}

  try {
    setLoadingType(type);
    alerts.info('Capturing GPS location. Please wait...', 'GPS Capture');

    if (type === 'check-in') {
      const payload = await buildAttendancePayload({
        ...savedGpsPayload(),
        mode,
        field_location: fieldLocation.trim(),
        field_photo_file: fieldPhotoFile,
        ...selectedReasonPayload(
          'late',
          lateReasonCode,
          lateOtherReason,
          lateReasonOptions,
        ),
      });

      await submitCheckIn(payload);

      alerts.success('Checked in successfully.', 'Checked In');

      setFieldLocation('');
      setFieldPhotoFile(null);
      setFieldPhotoPreview('');
      setLateReasonCode('');
      setLateOtherReason('');
    } else {
      const payload = await buildAttendancePayload({
        ...savedGpsPayload(),
        ...selectedReasonPayload(
          'early_checkout',
          earlyCheckoutReasonCode,
          earlyCheckoutOtherReason,
          earlyCheckoutReasonOptions,
        ),
      });

      await submitCheckOut(payload);

      alerts.success('Checked out successfully.', 'Checked Out');
      setEarlyCheckoutReasonCode('');
      setEarlyCheckoutOtherReason('');
    }

    try {
      await refreshAfterSuccess();
    } catch (refreshError) {
      console.error('Attendance refresh failed after successful attendance action:', refreshError);
    }
    return true;
  } catch (error) {
    let latestStatus = null;

    try {
      latestStatus = await getAttendanceStatus();
      setStatusData(latestStatus);
    } catch (statusError) {
      console.error('Unable to verify attendance status after attendance error:', statusError);
    }

    const latestAttendance = latestStatus?.attendance || null;
    const actionWasRecorded =
      type === 'check-in'
        ? Boolean(latestAttendance?.check_in)
        : Boolean(latestAttendance?.check_out);

    if (actionWasRecorded) {
      alerts.success(
        type === 'check-in'
          ? 'Checked in successfully.'
          : 'Checked out successfully.',
        type === 'check-in' ? 'Checked In' : 'Checked Out',
      );
    } else {
      alerts.error(
        attendanceErrorMessage(error),
        type === 'check-in' ? 'Check-in Failed' : 'Check-out Failed',
      );
    }
    return actionWasRecorded;
  } finally {
    setLoadingType('');
  }
}

async function submitHolidayWorkRequest(event) {
  event.preventDefault();

  if (!holidayRequestDate) {
    alerts.warning('Please select holiday work date.', 'Holiday Date Required');
    return;
  }

  if (!holidayReason.trim()) {
    alerts.warning('Please enter holiday work reason.', 'Holiday Reason Required');
    return;
  }

  if (!holidayWorkLocation.trim()) {
    alerts.warning('Please enter work location / place.', 'Work Location Required');
    return;
  }

  try {
    setLoadingType('holiday-work-request');
    alerts.info('Capturing GPS location. Please wait...', 'GPS Capture');

    const payload = await buildAttendancePayload({
      ...savedGpsPayload(),
      date: holidayRequestDate,
      reason: holidayReason.trim(),
      work_location: holidayWorkLocation.trim(),
      field_location: holidayWorkLocation.trim(),
      field_photo_file: holidayPhotoFile,
    });

    const data = await createHolidayWorkRequest(payload);

    alerts.success(
      data.message || 'Holiday work request submitted.',
      'Holiday Work Submitted',
    );

    setHolidayRequestDate(todayISO());
    setHolidayReason('');
    setHolidayWorkLocation('');
    setHolidayPhotoFile(null);
    setHolidayPhotoPreview('');
    setShowHolidayRequestForm(false);

    await refreshAfterSuccess();
  } catch (error) {
    alerts.error(attendanceErrorMessage(error), 'Holiday Work Submit Failed');
  } finally {
    setLoadingType('');
  }
}

  return (
    <div className="attendance-card attendance-pro-card">
      <style>{`
        .attendance-reason-panel {
          display: grid;
          gap: 10px;
          width: 100%;
          border: 1px solid #dbe5df;
          border-radius: 18px;
          background: linear-gradient(145deg, #fbfefc 0%, #f4faf6 100%);
          padding: 14px;
          box-sizing: border-box;
        }

        .attendance-reason-heading {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
        }

        .attendance-reason-heading label {
          color: #17252a;
          font-size: 14px;
          font-weight: 900;
          line-height: 1.4;
        }

        .attendance-reason-required {
          flex: 0 0 auto;
          border: 1px solid #fecaca;
          border-radius: 999px;
          background: #fff1f2;
          padding: 4px 9px;
          color: #be123c;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: .04em;
          text-transform: uppercase;
        }

        .attendance-reason-panel select {
          min-height: 48px;
          cursor: pointer;
          font-weight: 750;
        }

        .attendance-reason-panel select:disabled {
          cursor: not-allowed;
          background: #f8fafc;
          color: #64748b;
        }

        .attendance-other-reason {
          display: grid;
          gap: 8px;
          border-top: 1px dashed #cbd5e1;
          padding-top: 11px;
          animation: attendanceReasonReveal .2s ease-out;
        }

        .attendance-other-reason label {
          color: #334155;
          font-size: 13px;
          font-weight: 850;
        }

        .attendance-other-reason textarea {
          min-height: 88px;
          margin: 0;
          resize: vertical;
        }

        .attendance-other-reason textarea[aria-invalid='true'] {
          border-color: #f59e0b;
        }

        .attendance-reason-help {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          color: #64748b;
          font-size: 11px;
          font-weight: 700;
          line-height: 1.5;
        }

        .attendance-reason-help.is-error {
          color: #b45309;
        }

        .attendance-reason-help strong {
          flex: 0 0 auto;
          color: inherit;
          white-space: nowrap;
        }

        @keyframes attendanceReasonReveal {
          from {
            opacity: 0;
            transform: translateY(-4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @media (max-width: 560px) {
          .attendance-reason-heading,
          .attendance-reason-help {
            align-items: flex-start;
          }

          .attendance-reason-help {
            display: grid;
          }
        }
        /* Full-viewport checkout dialog: portal-mounted, outside the attendance card. */
        .sprint-checkout-backdrop {
          position: fixed;
          inset: 0;
          z-index: 2147483000;
          isolation: isolate;
          box-sizing: border-box;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          background: rgba(17, 24, 54, 0.56);
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
        }
        .sprint-checkout-dialog {
          display: flex;
          flex-direction: column;
          width: min(510px, 100%);
          max-height: min(85vh, 760px);
          min-height: 0;
          overflow: hidden;
          border: 1px solid #d9defa;
          border-radius: 23px;
          background: #ffffff;
          color: #192747;
          box-shadow: 0 32px 100px rgba(21, 31, 83, .3), 0 7px 24px rgba(36, 45, 102, .1);
          animation: sprintCheckoutReveal .2s ease-out;
        }
        @keyframes sprintCheckoutReveal {
          from { opacity: .65; transform: translateY(12px) scale(.985); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .sprint-checkout-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          padding: 21px 23px 18px;
          border-bottom: 1px solid #e7eafa;
          background: linear-gradient(115deg, #f0f5ff 0%, #f9f7ff 55%, #eefbf9 100%);
          flex: 0 0 auto;
        }
        .sprint-checkout-header h3 {
          margin: 3px 0 6px;
          color: #17264b;
          font-family: Georgia, 'Times New Roman', serif;
          font-size: 21px;
          font-weight: 700;
          line-height: 1.25;
        }
        .sprint-checkout-header p { margin: 0; color: #627397; font-size: 12.5px; line-height: 1.5; }
        .sprint-checkout-eyebrow {
          color: #5144cf !important;
          font-family: inherit;
          font-weight: 850;
          font-size: 10.5px !important;
          letter-spacing: .11em;
          text-transform: uppercase;
        }
        .sprint-checkout-close {
          display: grid;
          place-items: center;
          width: 34px;
          height: 34px;
          flex: 0 0 34px;
          border: 1px solid #d9dff4;
          border-radius: 10px;
          background: #fff;
          color: #596687;
          font-size: 23px;
          line-height: 1;
          cursor: pointer;
        }
        .sprint-checkout-close:hover { border-color: #b8b7ef; background: #f4f2ff; color: #5144cf; }
        .sprint-checkout-content {
          display: grid;
          gap: 11px;
          min-height: 0;
          overflow-y: auto;
          overscroll-behavior: contain;
          padding: 17px 21px;
          background: #fff;
        }
        .sprint-daily-summary {
          border: 1px solid #dfe5f8;
          border-radius: 14px;
          padding: 13px 15px;
          background: linear-gradient(120deg, #f5f7ff, #effbf9);
          color: #28375c;
        }
        .sprint-daily-summary > strong { font-size: 13px; }
        .sprint-daily-summary > span { float: right; font-size: 11px; color: #6253c9; font-weight: 750; }
        .sprint-daily-summary p { margin: 6px 0; color: #6c7795; font-size: 12px; line-height: 1.5; }
        .sprint-daily-summary details { margin-top: 9px; font-size: 12px; }
        .sprint-daily-summary summary { cursor: pointer; color: #584bdb; font-weight: 750; }
        .sprint-daily-summary ul { margin: 8px 0 0; padding-left: 17px; }
        .sprint-daily-summary li { padding: 2px 0; }
        .sprint-daily-form { display: grid; gap: 16px; padding: 15px; border: 1px solid #e2e8f6; border-radius: 15px; background: #fff; }
        .sprint-daily-note { margin: 0; color: #77839b; font-size: 11px; line-height: 1.55; }
        .sprint-checkout-task {
          display: grid;
          gap: 10px;
          padding: 15px;
          border: 1px solid #e0e6f6;
          border-radius: 15px;
          background: #fbfcff;
        }
        .sprint-checkout-task-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 9px; }
        .sprint-checkout-task-heading strong { color: #23345d; font-size: 13.5px; line-height: 1.4; }
        .sprint-checkout-task-heading span {
          flex-shrink: 0;
          padding: 4px 7px;
          border-radius: 100px;
          background: #f0edff;
          color: #6254ba;
          font-size: 10px;
          font-weight: 700;
        }
        .sprint-checkout-description { margin: 0; color: #7886a1; font-size: 12px; }
        .sprint-checkout-field { display: grid; gap: 6px; color: #2a3658; font-size: 12px; font-weight: 750; }
        .sprint-checkout-field input:not([type='checkbox']),
        .sprint-checkout-field select,
        .sprint-checkout-field textarea {
          box-sizing: border-box;
          width: 100%;
          padding: 10px 11px;
          border: 1px solid #d5def0;
          border-radius: 10px;
          outline: none;
          background: #fff;
          color: #20304d;
          font: 400 13px/1.5 inherit;
        }
        .sprint-checkout-field select:focus,
        .sprint-checkout-field textarea:focus,
        .sprint-checkout-field input:focus { border-color: #6b5bf0; box-shadow: 0 0 0 3px rgba(107, 91, 240, .11); }
        .sprint-checkout-field textarea { resize: vertical; min-height: 62px; }
        .sprint-checkout-field small, .sprint-checkout-evidence small { color: #77839b; font-size: 11px; font-weight: 400; }
        .sprint-checkout-field em, .sprint-checkout-evidence em { color: #d44865; font-style: normal; }
        .sprint-checkout-evidence, .sprint-checkout-custom-fields { display: grid; gap: 9px; padding-top: 10px; border-top: 1px dashed #d8e0f1; }
        .sprint-checkout-evidence > strong, .sprint-checkout-custom-fields > strong { font-size: 12px; }
        .sprint-checkout-evidence-actions { display: flex; flex-wrap: wrap; gap: 8px; }
        .sprint-checkout-evidence-action {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 36px;
          padding: 6px 12px;
          border: 1px solid #cbd6f5;
          border-radius: 10px;
          background: #f3f6ff;
          color: #4c4eaa;
          font-size: 12px;
          font-weight: 800;
          cursor: pointer;
        }
        .sprint-checkout-evidence-action:hover { background: #e9edff; border-color: #afaef0; }
        .sprint-checkout-evidence-action:focus-within { outline: 2px solid #6b5bf0; outline-offset: 2px; }
        .sprint-checkout-evidence-action input[type='file'] { position: absolute; width: 1px; height: 1px; opacity: 0; overflow: hidden; }
        .sprint-checkout-evidence-note { color: #77839b; font-size: 11px; }
        .sprint-checkout-footer {
          display: grid;
          gap: 12px;
          flex: 0 0 auto;
          padding: 13px 21px 17px;
          border-top: 1px solid #e8eafa;
          background: #fff;
        }
        .sprint-checkout-footer small { color: #7683a0; font-size: 11px; line-height: 1.5; }
        .sprint-checkout-footer > div { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 9px; }
        .sprint-checkout-footer button {
          min-height: 39px;
          padding: 9px 14px;
          border: 1px solid #d9def0;
          border-radius: 11px;
          background: #fff;
          color: #455172;
          font-weight: 750;
          cursor: pointer;
        }
        .sprint-checkout-footer button.primary {
          border-color: #5b4de1;
          background: linear-gradient(100deg, #5849df, #7162ed);
          color: #fff;
          box-shadow: 0 5px 14px rgba(91, 77, 225, .18);
        }
        .sprint-checkout-footer button:disabled { opacity: .6; cursor: not-allowed; }
        @media (max-width: 560px) {
          .sprint-checkout-backdrop { padding: 12px; }
          .sprint-checkout-dialog { max-height: min(92dvh, 760px); border-radius: 18px; }
          .sprint-checkout-header { padding: 16px; }
          .sprint-checkout-header h3 { font-size: 19px; }
          .sprint-checkout-content { padding: 12px; }
          .sprint-checkout-task { padding: 12px; }
          .sprint-checkout-footer { padding: 12px; }
          .sprint-checkout-task-heading { flex-wrap: wrap; }
          .sprint-checkout-footer > div { display: grid; grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="attendance-head">
        <div>
          <p className="attendance-kicker">Today&apos;s Attendance</p>
          <h3>{todayLabel}</h3>
          <p className="attendance-subtext">
            Office timing: {formatScheduleTime(officeStart)} to {formatScheduleTime(officeEnd)}.
            Late entry starts from {formatScheduleTime(lateCutoff)}. Scheduled break is{' '}
            {formatScheduleTime(breakStart)} to {formatScheduleTime(breakEnd)}. Office, WFH,
            and Field attendance can be marked directly. Field attendance requires visit place
            and photo.
          </p>
        </div>

        <button
          type="button"
          className="soft-refresh-btn"
          onClick={loadStatus}
          disabled={loadingStatus || loadingType !== ''}
        >
          {loadingStatus ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {holiday?.is_holiday && (
        <div className="holiday-banner">
          <div className="holiday-icon">🎉</div>
          <div>
            <strong>{holiday.title || 'Holiday'}</strong>
            <p>{holiday.message || 'Today is marked as a holiday.'}</p>

            {holidayCheckInBlocked && (
              <p>
                Holiday attendance requires approval from your Team Leader,
                Reporting Officer, or HR before check-in.
              </p>
            )}

            {holidayWorkApproved && (
              <p>
                Holiday work request approved. You can mark attendance today.
              </p>
            )}

            {holidayWorkRequest && !holidayWorkApproved && (
              <p>
                Current request status: {statusLabel(holidayWorkRequest.status)}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="attendance-summary">
        <div>
          <span>Status</span>
          <strong>{statusLabel(attendance?.status || 'pending')}</strong>
        </div>

        <div>
          <span>Mode</span>
          <strong>{modeLabel(attendance?.mode || mode)}</strong>
        </div>

        <div>
          <span>Check In</span>
          <strong>{formatTime(attendance?.check_in)}</strong>
        </div>

        <div>
          <span>Check Out</span>
          <strong>{formatTime(attendance?.check_out)}</strong>
        </div>
      </div>

      <div className="toggle-row attendance-mode-row">
        {availableModes.map((item) => (
          <button
            key={item}
            type="button"
            className={mode === item ? 'selected' : ''}
            onClick={() => setMode(item)}
            disabled={loadingType !== '' || checkedIn}
          >
            {modeLabel(item)}
          </button>
        ))}
      </div>



      {mode === 'field' && !checkedIn && (
        <div className="attendance-request-box">
          <input
            placeholder="Field location / visit place"
            value={fieldLocation}
            onChange={(e) => setFieldLocation(e.target.value)}
            disabled={loadingType !== ''}
          />

          <label>
            Field Photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => {
                const file = e.target.files?.[0] || null;
                setFieldPhotoFile(file);
                previewFile(file, setFieldPhotoPreview);
              }}
              disabled={loadingType !== ''}
            />
          </label>

          {fieldPhotoPreview && (
            <img
              src={fieldPhotoPreview}
              alt="Field preview"
              style={{
                width: 120,
                height: 90,
                objectFit: 'cover',
                borderRadius: 12,
                border: '1px solid #e2e8f0',
              }}
            />
          )}
        </div>
      )}

      {lateNow && !holiday?.is_holiday && !checkedIn && (
        <div className="attendance-reason-panel">
          <div className="attendance-reason-heading">
            <label htmlFor="late-attendance-reason">Late check-in reason</label>
            <span className="attendance-reason-required">Required</span>
          </div>

          <select
            id="late-attendance-reason"
            value={lateReasonCode}
            onChange={(event) => {
              const nextCode = event.target.value;
              setLateReasonCode(nextCode);

              if (nextCode !== OTHER_REASON_CODE) {
                setLateOtherReason('');
              }
            }}
            disabled={loadingType !== '' || loadingStatus}
          >
            <option value="">Select why you are late</option>
            {lateReasonOptions.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>

          {lateReasonCode === OTHER_REASON_CODE && (
            <div className="attendance-other-reason">
              <label htmlFor="late-attendance-other-reason">
                Write the complete reason
              </label>
              <textarea
                id="late-attendance-other-reason"
                placeholder="Explain the genuine reason for the late check-in"
                value={lateOtherReason}
                onChange={(event) => setLateOtherReason(event.target.value)}
                minLength={otherReasonMinLength}
                maxLength={otherReasonMaxLength}
                disabled={loadingType !== ''}
                required
                aria-invalid={Boolean(
                  lateOtherReason.trim() && lateOtherReasonError,
                )}
              />
              <div
                className={`attendance-reason-help${
                  lateOtherReason.trim() && lateOtherReasonError
                    ? ' is-error'
                    : ''
                }`}
              >
                <span>
                  {lateOtherReason.trim() && lateOtherReasonError
                    ? lateOtherReasonError
                    : `Use at least ${otherReasonMinLength} characters and 2 meaningful words. Dots, symbols, placeholder text, and gibberish are rejected.`}
                </span>
                <strong>
                  {lateOtherReason.length}/{otherReasonMaxLength}
                </strong>
              </div>
            </div>
          )}
        </div>
      )}

      {earlyCheckoutNow && !holiday?.is_holiday && checkedIn && !checkedOut && (
        <div className="attendance-reason-panel">
          <div className="attendance-reason-heading">
            <label htmlFor="early-checkout-attendance-reason">
              Early checkout reason
            </label>
            <span className="attendance-reason-required">Required</span>
          </div>

          <select
            id="early-checkout-attendance-reason"
            value={earlyCheckoutReasonCode}
            onChange={(event) => {
              const nextCode = event.target.value;
              setEarlyCheckoutReasonCode(nextCode);

              if (nextCode !== OTHER_REASON_CODE) {
                setEarlyCheckoutOtherReason('');
              }
            }}
            disabled={loadingType !== '' || loadingStatus}
          >
            <option value="">Select why you are checking out early</option>
            {earlyCheckoutReasonOptions.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>

          {earlyCheckoutReasonCode === OTHER_REASON_CODE && (
            <div className="attendance-other-reason">
              <label htmlFor="early-checkout-attendance-other-reason">
                Write the complete reason
              </label>
              <textarea
                id="early-checkout-attendance-other-reason"
                placeholder="Explain the genuine reason for checking out early"
                value={earlyCheckoutOtherReason}
                onChange={(event) => setEarlyCheckoutOtherReason(event.target.value)}
                minLength={otherReasonMinLength}
                maxLength={otherReasonMaxLength}
                disabled={loadingType !== ''}
                required
                aria-invalid={Boolean(
                  earlyCheckoutOtherReason.trim() &&
                  earlyCheckoutOtherReasonError,
                )}
              />
              <div
                className={`attendance-reason-help${
                  earlyCheckoutOtherReason.trim() &&
                  earlyCheckoutOtherReasonError
                    ? ' is-error'
                    : ''
                }`}
              >
                <span>
                  {earlyCheckoutOtherReason.trim() &&
                  earlyCheckoutOtherReasonError
                    ? earlyCheckoutOtherReasonError
                    : `Use at least ${otherReasonMinLength} characters and 2 meaningful words. Dots, symbols, placeholder text, and gibberish are rejected.`}
                </span>
                <strong>
                  {earlyCheckoutOtherReason.length}/{otherReasonMaxLength}
                </strong>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="attendance-hold-grid">
        <HoldButton
          label={
            holidayCheckInBlocked
              ? 'Holiday Approval Required'
              : checkedIn
                ? 'Already Checked In'
                : 'Press & Hold to Check In'
          }
            loadingLabel={
              loadingType === 'check-in' ? 'Checking In...' : 'Processing...'
            }
          loading={loadingType === 'check-in'}
          disabled={loadingType !== ''}
          onComplete={() => submitAttendance('check-in')}
          variant="primary"
        />

        <HoldButton
          label={
            !checkedIn
              ? 'Check In First'
              : checkedOut
                ? 'Already Checked Out'
                : 'Press & Hold to Check Out'
          }
          loadingLabel={
            loadingType === 'check-out' ? 'Checking Out...' : 'Processing...'
          }
          loading={loadingType === 'check-out'}
          disabled={loadingType !== '' || Boolean(sprintCheckout)}
          onComplete={() => submitAttendance('check-out')}
          variant="secondary"
        />
      </div>


          <div className="attendance-extra-grid">
            <button
              type="button"
              className="mini-action-btn"
              onClick={refreshGps}
              disabled={loadingType !== ''}
            >
              {loadingType === 'gps-refresh' ? 'Refreshing GPS...' : 'Refresh GPS'}
            </button>

            {currentGps?.latitude && currentGps?.longitude && (
              <div className="compoff-pill">
                {gpsStatusText(currentGps)}
              </div>
            )}

            {holiday?.is_holiday && (
              <button
                type="button"
                className="mini-action-btn"
                onClick={() => setShowHolidayRequestForm((value) => !value)}
                disabled={loadingType !== '' || holidayWorkApproved}
              >
                {showHolidayRequestForm ? 'Close Holiday Request' : 'Request Holiday Work'}
              </button>
            )}

            {availableCompOffCount > 0 && (
              <div className="compoff-pill">
                Available Comp-Off: {availableCompOffCount}
              </div>
            )}
          </div>

      {showHolidayRequestForm && (
        <form className="attendance-request-box" onSubmit={submitHolidayWorkRequest}>
          <div className="form-grid">
            <label>
              Holiday Work Date
              <input
                type="date"
                value={holidayRequestDate}
                onChange={(e) => setHolidayRequestDate(e.target.value)}
                disabled={loadingType !== ''}
              />
            </label>

            <label>
              Work Location / Place
              <input
                placeholder="Example: Udalguri Field Visit"
                value={holidayWorkLocation}
                onChange={(e) => setHolidayWorkLocation(e.target.value)}
                disabled={loadingType !== ''}
              />
            </label>
          </div>

          <textarea
            placeholder="Reason for working on holiday"
            value={holidayReason}
            onChange={(e) => setHolidayReason(e.target.value)}
            disabled={loadingType !== ''}
          />

          <label>
            Supporting Photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => {
                const file = e.target.files?.[0] || null;
                setHolidayPhotoFile(file);
                previewFile(file, setHolidayPhotoPreview);
              }}
              disabled={loadingType !== ''}
            />
          </label>

          {holidayPhotoPreview && (
            <img
              src={holidayPhotoPreview}
              alt="Holiday work preview"
              style={{
                width: 120,
                height: 90,
                objectFit: 'cover',
                borderRadius: 12,
                border: '1px solid #e2e8f0',
              }}
            />
          )}

          <div className="mode-note">
            {approverText}
          </div>

          <button
            type="submit"
            className="primary"
            disabled={loadingType !== ''}
          >
            {loadingType === 'holiday-work-request'
              ? 'Submitting...'
              : 'Submit Holiday Work Request'}
          </button>
        </form>
      )}

      {sprintCheckout && createPortal(
        <div className="sprint-checkout-backdrop" role="presentation">
          <section
            className="sprint-checkout-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sprint-checkout-title"
          >
            <div className="sprint-checkout-header">
              <div>
                <p className="sprint-checkout-eyebrow">Daily Work Report</p>
                <h3 id="sprint-checkout-title">Daily Work Report before checkout</h3>
                <p>{sprintCheckout.workDate} · Only today's pending tasks need reporting. Unfinished work is allowed with a reason.</p>
              </div>
              <button
                type="button"
                className="sprint-checkout-close"
                disabled={loadingType !== ''}
                aria-label="Close Sprint report"
                onClick={() => setSprintCheckout(null)}
              >×</button>
            </div>

            <div className="sprint-checkout-content">
              <div className="sprint-daily-summary">
                <strong>Today's work</strong>
                <span>{sprintCheckout.items.length} pending {sprintCheckout.items.length === 1 ? 'activity' : 'activities'}</span>
                <p>Give one overall answer for the pending work. It will be recorded against each pending activity.</p>
                <details>
                  <summary>View assigned activities</summary>
                  <ul>{sprintCheckout.items.map((item) => <li key={item.key}>{item.title}</li>)}</ul>
                </details>
              </div>
              <div className="sprint-daily-form">
                <label className="sprint-checkout-field">
                  Did you complete all of today's pending work? <em>*</em>
                  <select
                    value={sprintCheckout.dailyStatus || ''}
                    disabled={loadingType !== ''}
                    onChange={(event) => setSprintCheckout((current) => current && ({
                      ...current, dailyStatus: event.target.value,
                    }))}
                  >
                    <option value="">Select work status</option>
                    <option value="completed">Yes, completed</option>
                    <option value="not_completed">No, unfinished</option>
                  </select>
                </label>

                {sprintCheckout.dailyStatus === 'not_completed' && (
                  <label className="sprint-checkout-field">
                    Why was the work unfinished? <em>*</em>
                    <textarea
                      rows={3}
                      maxLength={1000}
                      placeholder="Provide the actual reason (minimum 10 characters)"
                      value={sprintCheckout.dailyReason || ''}
                      disabled={loadingType !== ''}
                      onChange={(event) => setSprintCheckout((current) => current && ({
                        ...current, dailyReason: event.target.value,
                      }))}
                    />
                  </label>
                )}

                {sprintCheckout.dailyStatus === 'completed' && (
                  <div className="sprint-checkout-evidence">
                    <strong>Evidence of completed work <em>*</em></strong>
                    <label className="sprint-checkout-field">
                      Evidence URL
                      <input
                        type="url"
                        placeholder="https://..."
                        value={sprintCheckout.dailyEvidenceUrl || ''}
                        disabled={loadingType !== ''}
                        onChange={(event) => setSprintCheckout((current) => current && ({
                          ...current, dailyEvidenceUrl: event.target.value,
                        }))}
                      />
                    </label>
                    <div className="sprint-checkout-evidence-actions">
                      <label className="sprint-checkout-evidence-action">
                        Upload Document
                        <input
                          type="file"
                          accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.txt,.csv,image/*"
                          disabled={loadingType !== ''}
                          onChange={(event) => setSprintCheckout((current) => current && ({
                            ...current, dailyEvidenceFile: event.target.files?.[0] || null,
                          }))}
                        />
                      </label>
                      <label className="sprint-checkout-evidence-action">
                        Take Photo
                        <input
                          type="file" accept="image/*" capture="environment"
                          disabled={loadingType !== ''}
                          onChange={(event) => setSprintCheckout((current) => current && ({
                            ...current, dailyEvidenceFile: event.target.files?.[0] || null,
                          }))}
                        />
                      </label>
                    </div>
                    {sprintCheckout.dailyEvidenceFile &&
                      <small className="sprint-checkout-evidence-note">Selected: {sprintCheckout.dailyEvidenceFile.name}</small>}
                  </div>
                )}
                <p className="sprint-daily-note">If some activities were completed and others were not, report them individually in Sprint Planning. Your checkout will then continue without asking again.</p>
              </div>
            </div>
            <div className="sprint-checkout-footer">
              <small>Your answer is saved to the Sprint Daily Work Report for each pending activity. Checkout happens only after successful saving.</small>
              <div>
                <button type="button" disabled={loadingType !== ''}
                  onClick={() => setSprintCheckout(null)}>Cancel</button>
                <button type="button" className="primary"
                  disabled={loadingType !== ''}
                  onClick={submitSprintReportAndCheckout}>
                  {loadingType === 'sprint-report' ? 'Saving report...' :
                    loadingType === 'check-out' ? 'Checking out...' :
                      'Submit Report & Checkout'}
                </button>
              </div>
            </div>
          </section>
        </div>,
        document.body
      )}

      {holidayWorkRequest && (
        <div className="pending-request-list">
          <strong>Holiday Work Request</strong>

          <div className="pending-request-item">
            <span>
              {holidayWorkRequest.date} • {holidayWorkRequest.work_location || 'Holiday Work'}
            </span>
            <em>{statusLabel(holidayWorkRequest.status)}</em>
          </div>
        </div>
      )}
    </div>
  );
}
