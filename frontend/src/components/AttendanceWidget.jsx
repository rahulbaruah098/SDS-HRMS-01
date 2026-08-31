import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildAttendancePayload,
  createHolidayWorkRequest,
  getAttendanceStatus,
  getCurrentLocation,
  submitCheckIn,
  submitCheckOut,
} from '../api/client';
import { useCustomAlert } from './CustomAlertProvider.jsx';

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


async function submitAttendance(type) {
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

      const data = await submitCheckIn(payload);

      if (lateNow && !holiday?.is_holiday) {
        alerts.warning(
          data.message || 'Late check-in recorded successfully.',
          'Late Check-in Recorded',
        );
      } else {
        alerts.success(data.message || 'Check-in successful.', 'Check-in Successful');
      }

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

      const data = await submitCheckOut(payload);

      alerts.success(data.message || 'Check-out successful.', 'Check-out Successful');
      setEarlyCheckoutReasonCode('');
      setEarlyCheckoutOtherReason('');
    }

    await refreshAfterSuccess();
  } catch (error) {
    alerts.error(
      attendanceErrorMessage(error),
      type === 'check-in' ? 'Check-in Failed' : 'Check-out Failed',
    );
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
          disabled={loadingType !== ''}
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
