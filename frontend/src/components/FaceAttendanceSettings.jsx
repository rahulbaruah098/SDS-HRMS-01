import { useEffect, useState } from 'react';
import { AlertTriangle, Camera, CheckCircle2, ScanFace, ShieldCheck, Users } from 'lucide-react';
import { getFaceAttendanceSettings, updateFaceAttendanceSettings } from '../api/faceAttendance';
import '../styles/face-activation-settings.css';

const names = {
  off: 'Inactive',
  prepare: 'Enrollment preparation',
  enforce: 'Camera verification ON',
};

export default function FaceAttendanceSettings({ confirmChange, onOpenEnrollment }) {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      setSettings(await getFaceAttendanceSettings());
    } catch (e) {
      setError(e?.message || 'Unable to load facial attendance settings.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { refresh(); }, []);

  async function changeMode(next) {
    if (saving || loading || !settings?.can_manage || next === settings.mode) return;
    const warning = next === 'enforce'
      ? `Require a live camera scan at BOTH check-in and checkout for employees in this organisation? Employees without enrollment or a temporary approved exception may be blocked. Enrolled now: ${settings.readiness?.registered || 0}.`
      : next === 'prepare'
        ? 'Enable voluntary consent and facial training without requiring a camera for attendance? Existing check-in and checkout continue normally.'
        : 'Turn facial training and camera enforcement OFF? Encrypted enrollment records are retained according to the privacy notice unless withdrawn or expired.';
    const approved = await confirmChange(warning,
      next === 'enforce' ? 'Activate facial verification' : next === 'prepare' ? 'Enable enrollment preparation' : 'Deactivate facial attendance',
      { confirmLabel: next === 'enforce' ? 'Turn camera ON' : next === 'prepare' ? 'Start preparation' : 'Turn OFF' });
    if (!approved) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const result = await updateFaceAttendanceSettings(
        next, settings.revision, next === 'enforce');
      setSettings(result);
      setNotice(next === 'enforce'
        ? 'Live face matching is now required for attendance.'
        : next === 'prepare'
          ? 'Enrollment is enabled. Attendance does not yet require a camera.'
          : 'Facial attendance is OFF; normal attendance remains available.');
      window.dispatchEvent(new Event('yourcomate:face-setting-changed'));
    } catch (e) {
      setError(e?.message || 'Unable to save facial attendance setting.');
      // Retry can use a fresh revision after concurrent change.
      try { setSettings(await getFaceAttendanceSettings()); } catch { /* keep useful error */ }
    } finally {
      setSaving(false);
    }
  }

  const mode = settings?.mode || 'off';
  const ready = Number(settings?.readiness?.registered || 0);
  const busy = loading || saving;

  return (
    <section className="payroll-branding-panel face-activation" aria-label="Facial Attendance Settings">
      <div className="payroll-branding-heading">
        <div>
          <span className="payroll-branding-kicker"><ScanFace size={15} /> Facial Attendance Settings</span>
          <h1>Face Recognition Attendance</h1>
          <p>Company-specific activation, employee face training, and secure live verification for check-in and checkout.</p>
        </div>
      </div>
      <div className="fa-status-bar">
        <div>
          <strong>{loading ? 'Loading face attendance…' : names[mode]}</strong>
          <p>{mode === 'enforce'
            ? 'Camera matching is mandatory unless an approved exception applies.'
            : mode === 'prepare'
              ? 'Employees can consent and enroll; existing attendance continues normally.'
              : 'Face verification is inactive. Prepare enrollments before switching it on.'}</p>
        </div>
        <button
          type="button" role="switch" aria-label="Require facial verification for attendance"
          aria-checked={mode === 'enforce'} aria-busy={saving}
          className={`fa-toggle ${mode === 'enforce' ? 'is-on' : ''}`}
          disabled={busy || !settings?.can_manage || (mode === 'off')}
          onClick={() => changeMode(mode === 'enforce' ? 'prepare' : 'enforce')}
        ><span className="fa-toggle-text">{saving ? '...' : mode === 'enforce' ? 'ON' : 'OFF'}</span><span className="fa-toggle-knob" /></button>
      </div>
      <div className="fa-setting-steps">
        <div><ShieldCheck size={19} /><strong>1. Prepare</strong><p>Enable employee consent and enrollment.</p></div>
        <div><Users size={19} /><strong>2. Train</strong><p>Register 3–5 distinct photos for each consenting employee.</p></div>
        <div><Camera size={19} /><strong>3. Activate</strong><p>Turn camera verification ON for check-in and checkout.</p></div>
      </div>
      <div className="fa-controls">
        {mode === 'off' ? (
          <button className="fa-primary" type="button" onClick={() => changeMode('prepare')} disabled={busy || !settings?.can_manage}>Enable enrollment preparation</button>
        ) : (
          <button className="fa-primary" type="button" onClick={onOpenEnrollment} disabled={busy}><ScanFace size={16} /> Open Face Training</button>
        )}
        {mode === 'prepare' && <button type="button" className="fa-secondary" onClick={() => changeMode('off')} disabled={busy}>Turn everything OFF</button>}
        <button type="button" className="fa-secondary" onClick={refresh} disabled={busy}>Refresh status</button>
      </div>
      {mode !== 'off' && <div className="fa-readiness"><CheckCircle2 size={17} /> <span>{ready} enrolled facial template{ready === 1 ? '' : 's'} · {Number(settings?.readiness?.temporary_exceptions || 0)} active temporary exception(s)</span></div>}
      {mode === 'prepare' && ready === 0 && <p className="fa-warning"><AlertTriangle size={16} /> Enroll at least one employee before enabling mandatory verification.</p>}
      {mode === 'enforce' && <p className="fa-warning"><AlertTriangle size={16} /> New or unenrolled employees need registration or an HR-approved exception before attendance.</p>}
      {error && <div role="alert" className="fa-error">{error}</div>}
      {notice && <div role="status" className="fa-success">{notice}</div>}
    </section>
  );
}
