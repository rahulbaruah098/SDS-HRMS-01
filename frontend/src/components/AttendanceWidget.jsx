import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildAttendancePayload,
  createHolidayWorkRequest,
  getAttendanceStatus,
  submitCheckIn,
  submitCheckOut,
} from '../api/client';

const HOLD_DURATION = 1600;


function formatTodayLabel() {
  return new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function isLateNow() {
  const now = new Date();
  return now.getHours() > 9 || (now.getHours() === 9 && now.getMinutes() >= 50);
}

function isEarlyCheckoutNow() {
  const now = new Date();
  return now.getHours() < 18;
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
  const [mode, setMode] = useState('office');
  const [fieldLocation, setFieldLocation] = useState('');
  const [fieldPhotoFile, setFieldPhotoFile] = useState(null);
  const [fieldPhotoPreview, setFieldPhotoPreview] = useState('');
  const [lateReason, setLateReason] = useState('');
  const [earlyCheckoutReason, setEarlyCheckoutReason] = useState('');

  const [holidayRequestDate, setHolidayRequestDate] = useState(todayISO());
  const [holidayReason, setHolidayReason] = useState('');
  const [holidayWorkLocation, setHolidayWorkLocation] = useState('');
  const [holidayPhotoFile, setHolidayPhotoFile] = useState(null);
  const [holidayPhotoPreview, setHolidayPhotoPreview] = useState('');
  const [showHolidayRequestForm, setShowHolidayRequestForm] = useState(false);

  const [statusData, setStatusData] = useState(null);
  const [message, setMessage] = useState('');
  const [loadingType, setLoadingType] = useState('');
  const [loadingStatus, setLoadingStatus] = useState(false);

  const attendance = statusData?.attendance || null;
  const holiday = statusData?.holiday || {};
  const availableModes = statusData?.available_modes || ['office', 'wfh', 'field'];
  const holidayWorkRequest = statusData?.holiday_work_request || null;
  const holidayWorkApproved = Boolean(statusData?.holiday_work_approved);
  const holidayCheckInBlocked = Boolean(statusData?.holiday_check_in_blocked);
  const compOffs = statusData?.compoffs || [];
  const employee = statusData?.employee || statusData?.employee_summary || {};

  const checkedIn = Boolean(attendance?.check_in);
  const checkedOut = Boolean(attendance?.check_out);
  const lateNow = isLateNow();
  const earlyCheckoutNow = isEarlyCheckoutNow();

  const todayLabel = useMemo(() => formatTodayLabel(), []);
  const availableCompOffCount = compOffs.filter((item) => item.status === 'available').length;

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
      setMessage('');

      const data = await getAttendanceStatus();
      setStatusData(data);

      const modes = data?.available_modes || ['office'];

      if (!modes.includes(mode)) {
        setMode(modes[0] || 'office');
      }
    } catch (error) {
      setMessage(error.message || 'Unable to load attendance status');
    } finally {
      setLoadingStatus(false);
    }
  }

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshAfterSuccess() {
    await loadStatus();

    if (typeof onSuccess === 'function') {
      await onSuccess();
    }
  }

  async function submitAttendance(type) {
    setMessage('');

    if (type === 'check-in') {
      if (holidayCheckInBlocked) {
        setMessage('Today is a holiday. Please submit a Holiday Work Request and wait for approval before check-in.');
        setShowHolidayRequestForm(true);
        return;
      }

      if (!availableModes.includes(mode)) {
        setMessage(`${modeLabel(mode)} check-in is not available for today`);
        return;
      }

      if (mode === 'field' && !fieldLocation.trim()) {
        setMessage('Field location / visit place is required for field check-in');
        return;
      }

      if (mode === 'field' && !fieldPhotoFile) {
        setMessage('Field photo is required for field check-in');
        return;
      }

      if (lateNow && !lateReason.trim() && !holiday?.is_holiday) {
        setMessage('Late reason is required from 09:50 AM onwards');
        return;
      }
    }

    if (type === 'check-out') {
      if (earlyCheckoutNow && !earlyCheckoutReason.trim() && !holiday?.is_holiday) {
        setMessage('Early checkout reason is required before 06:00 PM');
        return;
      }
    }

    try {
      setLoadingType(type);
      setMessage('Preparing attendance details...');

      if (type === 'check-in') {
        const payload = await buildAttendancePayload({
          mode,
          field_location: fieldLocation.trim(),
          field_photo_file: fieldPhotoFile,
          late_reason: lateReason.trim(),
        });

        const data = await submitCheckIn(payload);

        setMessage(data.message || 'Check-in successful');
        setFieldLocation('');
        setFieldPhotoFile(null);
        setFieldPhotoPreview('');
        setLateReason('');
      } else {
        const payload = await buildAttendancePayload({
          early_checkout_reason: earlyCheckoutReason.trim(),
        });

        const data = await submitCheckOut(payload);

        setMessage(data.message || 'Check-out successful');
        setEarlyCheckoutReason('');
      }

      await refreshAfterSuccess();
    } catch (error) {
      setMessage(error.message || 'Attendance update failed');
    } finally {
      setLoadingType('');
    }
  }

  async function submitHolidayWorkRequest(event) {
    event.preventDefault();
    setMessage('');

    if (!holidayRequestDate) {
      setMessage('Please select holiday work date');
      return;
    }

    if (!holidayReason.trim()) {
      setMessage('Please enter holiday work reason');
      return;
    }

    if (!holidayWorkLocation.trim()) {
      setMessage('Please enter work location / place');
      return;
    }

    try {
      setLoadingType('holiday-work-request');

      const payload = await buildAttendancePayload({
        date: holidayRequestDate,
        reason: holidayReason.trim(),
        work_location: holidayWorkLocation.trim(),
        field_location: holidayWorkLocation.trim(),
        field_photo_file: holidayPhotoFile,
      });

      const data = await createHolidayWorkRequest(payload);

      setMessage(data.message || 'Holiday work request submitted');
      setHolidayRequestDate(todayISO());
      setHolidayReason('');
      setHolidayWorkLocation('');
      setHolidayPhotoFile(null);
      setHolidayPhotoPreview('');
      setShowHolidayRequestForm(false);

      await refreshAfterSuccess();
    } catch (error) {
      setMessage(error.message || 'Holiday work request submission failed');
    } finally {
      setLoadingType('');
    }
  }

  return (
    <div className="attendance-card attendance-pro-card">
      <div className="attendance-head">
        <div>
          <p className="attendance-kicker">Today&apos;s Attendance</p>
          <h3>{todayLabel}</h3>
          <p className="attendance-subtext">
            Office timing: 09:30 AM to 06:00 PM. Late entry starts from 09:50 AM.
            Office, WFH, and Field attendance can be marked directly. Field
            attendance requires visit place and photo.
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
        <textarea
          placeholder="Late reason required from 09:50 AM onwards"
          value={lateReason}
          onChange={(e) => setLateReason(e.target.value)}
          disabled={loadingType !== ''}
        />
      )}

      {earlyCheckoutNow && !holiday?.is_holiday && checkedIn && !checkedOut && (
        <textarea
          placeholder="Early checkout reason required before 06:00 PM"
          value={earlyCheckoutReason}
          onChange={(e) => setEarlyCheckoutReason(e.target.value)}
          disabled={loadingType !== ''}
        />
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
          disabled={loadingType !== '' || checkedIn || holidayCheckInBlocked}
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
          disabled={loadingType !== '' || !checkedIn || checkedOut}
          onComplete={() => submitAttendance('check-out')}
          variant="secondary"
        />
      </div>

      <div className="attendance-extra-grid">
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

      {message && <div className="inline-message">{message}</div>}
    </div>
  );
}