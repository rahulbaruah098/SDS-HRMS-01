import { useState } from 'react';
import { api } from '../api/client';

export default function AttendanceWidget() {
  const [mode, setMode] = useState('office');
  const [fieldLocation, setFieldLocation] = useState('');
  const [lateReason, setLateReason] = useState('');
  const [message, setMessage] = useState('');

  const now = new Date();
  const isLate = now.getHours() > 9 || (now.getHours() === 9 && now.getMinutes() > 45);

  async function submitAttendance(type) {
    setMessage('');
    try {
      const data = await api(`/attendance/${type}`, {
        method: 'POST',
        body: JSON.stringify({
          mode,
          field_location: fieldLocation,
          late_reason: lateReason,
        }),
      });
      setMessage(data.message);
    } catch (error) {
      setMessage(error.message);
    }
  }

  return (
    <div className="attendance-card">
      <h3>Attendance</h3>
      <div className="toggle-row">
        <button className={mode === 'office' ? 'selected' : ''} onClick={() => setMode('office')}>
          Office
        </button>
        <button className={mode === 'field' ? 'selected' : ''} onClick={() => setMode('field')}>
          Field
        </button>
      </div>

      {mode === 'field' && (
        <input
          placeholder="Field location / visit place"
          value={fieldLocation}
          onChange={(e) => setFieldLocation(e.target.value)}
        />
      )}

      {isLate && (
        <textarea
          placeholder="Late reason required after 09:45 AM"
          value={lateReason}
          onChange={(e) => setLateReason(e.target.value)}
        />
      )}

      <div className="row-actions">
        <button className="primary" onClick={() => submitAttendance('check-in')}>
          Check In
        </button>
        <button className="secondary" onClick={() => submitAttendance('check-out')}>
          Check Out
        </button>
      </div>

      {message && <div className="inline-message">{message}</div>}
    </div>
  );
}
