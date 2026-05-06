import { useState } from 'react';
import { api } from '../api/client';

export default function AttendanceWidget({ onSuccess }) {
  const [mode, setMode] = useState('office');
  const [fieldLocation, setFieldLocation] = useState('');
  const [lateReason, setLateReason] = useState('');
  const [message, setMessage] = useState('');
  const [loadingType, setLoadingType] = useState('');

  const now = new Date();

  const isLate =
    now.getHours() > 9 || (now.getHours() === 9 && now.getMinutes() > 45);

  async function submitAttendance(type) {
    setMessage('');

    if (type === 'check-in') {
      if (mode === 'field' && !fieldLocation.trim()) {
        setMessage('Field location is required for field mode');
        return;
      }

      if (isLate && !lateReason.trim()) {
        setMessage('Late reason is required after 09:45 AM');
        return;
      }
    }

    try {
      setLoadingType(type);

      const payload =
        type === 'check-in'
          ? {
              mode,
              field_location: fieldLocation.trim(),
              late_reason: lateReason.trim(),
            }
          : {};

      const data = await api(`/attendance/${type}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setMessage(data.message || 'Attendance updated successfully');

      if (type === 'check-in') {
        setFieldLocation('');
        setLateReason('');
      }

      if (typeof onSuccess === 'function') {
        await onSuccess();
      }
    } catch (error) {
      setMessage(error.message || 'Attendance update failed');
    } finally {
      setLoadingType('');
    }
  }

  return (
    <div className="attendance-card">
      <h3>Attendance</h3>

      <div className="toggle-row">
        <button
          type="button"
          className={mode === 'office' ? 'selected' : ''}
          onClick={() => setMode('office')}
          disabled={loadingType !== ''}
        >
          Office
        </button>

        <button
          type="button"
          className={mode === 'field' ? 'selected' : ''}
          onClick={() => setMode('field')}
          disabled={loadingType !== ''}
        >
          Field
        </button>
      </div>

      {mode === 'field' && (
        <input
          placeholder="Field location / visit place"
          value={fieldLocation}
          onChange={(e) => setFieldLocation(e.target.value)}
          disabled={loadingType !== ''}
        />
      )}

      {isLate && (
        <textarea
          placeholder="Late reason required after 09:45 AM"
          value={lateReason}
          onChange={(e) => setLateReason(e.target.value)}
          disabled={loadingType !== ''}
        />
      )}

      <div className="row-actions">
        <button
          type="button"
          className="primary"
          onClick={() => submitAttendance('check-in')}
          disabled={loadingType !== ''}
        >
          {loadingType === 'check-in' ? 'Checking In...' : 'Check In'}
        </button>

        <button
          type="button"
          className="secondary"
          onClick={() => submitAttendance('check-out')}
          disabled={loadingType !== ''}
        >
          {loadingType === 'check-out' ? 'Checking Out...' : 'Check Out'}
        </button>
      </div>

      {message && <div className="inline-message">{message}</div>}
    </div>
  );
}