import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createAttendanceModeRequest,
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

function getCurrentLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Location permission is not supported on this device/browser'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          address: '',
        });
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          reject(new Error('Location permission is required for attendance'));
          return;
        }

        if (error.code === error.POSITION_UNAVAILABLE) {
          reject(new Error('Unable to fetch current location. Please enable GPS/location services.'));
          return;
        }

        if (error.code === error.TIMEOUT) {
          reject(new Error('Location request timed out. Please try again.'));
          return;
        }

        reject(new Error('Unable to fetch current location'));
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      },
    );
  });
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
  const [lateReason, setLateReason] = useState('');
  const [earlyCheckoutReason, setEarlyCheckoutReason] = useState('');
  const [requestMode, setRequestMode] = useState('wfh');
  const [requestDate, setRequestDate] = useState('');
  const [requestReason, setRequestReason] = useState('');
  const [requestFieldLocation, setRequestFieldLocation] = useState('');
  const [statusData, setStatusData] = useState(null);
  const [message, setMessage] = useState('');
  const [loadingType, setLoadingType] = useState('');
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [showRequestForm, setShowRequestForm] = useState(false);

  const attendance = statusData?.attendance || null;
  const holiday = statusData?.holiday || {};
  const availableModes = statusData?.available_modes || ['office'];
  const pendingRequests = statusData?.pending_mode_requests || [];
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
      if (!availableModes.includes(mode)) {
        setMessage(`${modeLabel(mode)} check-in is not approved for today`);
        return;
      }

      if (mode === 'field' && !fieldLocation.trim()) {
        setMessage('Field location / visit place is required for field check-in');
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
      setMessage('Fetching exact location...');

      const location = await getCurrentLocation();

      if (type === 'check-in') {
        const data = await submitCheckIn({
          mode,
          field_location: fieldLocation.trim(),
          late_reason: lateReason.trim(),
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy,
          address: location.address,
        });

        setMessage(data.message || 'Check-in successful');
        setFieldLocation('');
        setLateReason('');
      } else {
        const data = await submitCheckOut({
          early_checkout_reason: earlyCheckoutReason.trim(),
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy,
          address: location.address,
        });

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

  async function submitModeRequest(event) {
    event.preventDefault();
    setMessage('');

    if (!requestDate) {
      setMessage('Please select request date');
      return;
    }

    if (!requestReason.trim()) {
      setMessage('Please enter request reason');
      return;
    }

    if (requestMode === 'field' && !requestFieldLocation.trim()) {
      setMessage('Field visit place is required');
      return;
    }

    try {
      setLoadingType('mode-request');

      const data = await createAttendanceModeRequest({
        mode: requestMode,
        date: requestDate,
        reason: requestReason.trim(),
        field_location: requestFieldLocation.trim(),
      });

      setMessage(data.message || 'Request submitted');
      setRequestDate('');
      setRequestReason('');
      setRequestFieldLocation('');
      setShowRequestForm(false);

      await refreshAfterSuccess();
    } catch (error) {
      setMessage(error.message || 'Request submission failed');
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
            Exact latitude and longitude are required for every check-in and
            check-out.
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

      {!availableModes.includes('wfh') && !availableModes.includes('field') && (
        <div className="mode-note">
          WFH and Field buttons will appear only after approval from mapped
          Team Leader, Reporting Officer, or HR fallback.
        </div>
      )}

      {mode === 'field' && !checkedIn && (
        <input
          placeholder="Field location / visit place"
          value={fieldLocation}
          onChange={(e) => setFieldLocation(e.target.value)}
          disabled={loadingType !== ''}
        />
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
          label={checkedIn ? 'Already Checked In' : 'Press & Hold to Check In'}
          loadingLabel={
            loadingType === 'check-in' ? 'Checking In...' : 'Processing...'
          }
          loading={loadingType === 'check-in'}
          disabled={loadingType !== '' || checkedIn}
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
        <button
          type="button"
          className="mini-action-btn"
          onClick={() => setShowRequestForm((value) => !value)}
          disabled={loadingType !== ''}
        >
          {showRequestForm ? 'Close Request Form' : 'Request WFH / Field'}
        </button>

        {availableCompOffCount > 0 && (
          <div className="compoff-pill">
            Available Comp-Off: {availableCompOffCount}
          </div>
        )}
      </div>

      {showRequestForm && (
        <form className="attendance-request-box" onSubmit={submitModeRequest}>
          <div className="form-grid">
            <label>
              Request Type
              <select
                value={requestMode}
                onChange={(e) => setRequestMode(e.target.value)}
                disabled={loadingType !== ''}
              >
                <option value="wfh">Work From Home</option>
                <option value="field">Field</option>
              </select>
            </label>

            <label>
              Date
              <input
                type="date"
                value={requestDate}
                onChange={(e) => setRequestDate(e.target.value)}
                disabled={loadingType !== ''}
              />
            </label>
          </div>

          {requestMode === 'field' && (
            <input
              placeholder="Field visit place"
              value={requestFieldLocation}
              onChange={(e) => setRequestFieldLocation(e.target.value)}
              disabled={loadingType !== ''}
            />
          )}

          <textarea
            placeholder="Reason for request"
            value={requestReason}
            onChange={(e) => setRequestReason(e.target.value)}
            disabled={loadingType !== ''}
          />

          <div className="mode-note">
            {approverText}
          </div>

          <button
            type="submit"
            className="primary"
            disabled={loadingType !== ''}
          >
            {loadingType === 'mode-request' ? 'Submitting...' : 'Submit Request'}
          </button>
        </form>
      )}

      {pendingRequests.length > 0 && (
        <div className="pending-request-list">
          <strong>Pending Requests</strong>

          {pendingRequests.map((item) => (
            <div key={item._id} className="pending-request-item">
              <span>
                {modeLabel(item.mode)} • {item.date}
              </span>
              <em>{statusLabel(item.status)}</em>
            </div>
          ))}
        </div>
      )}

      {message && <div className="inline-message">{message}</div>}
    </div>
  );
}