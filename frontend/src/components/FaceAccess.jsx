import { useEffect, useState } from 'react';
import { ScanFace, ShieldCheck } from 'lucide-react';
import { faceRequest } from '../api/faceAttendance';
import FaceDialog from './FaceDialog';

export function FaceAccess({ setPage }) {
  const [access, setAccess] = useState(null),
    [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [accessError, setAccessError] = useState('');
  useEffect(() => {
    let active = true;
    const reload = () => {
      faceRequest('access')
        .then((r) => { if (active) { setAccess(r); setAccessError(''); } })
        .catch((e) => { if (active) setAccessError(e.message || 'Face attendance unavailable.'); });
    };
    reload();
    window.addEventListener('yourcomate:face-setting-changed', reload);
    return () => {
      active = false;
      window.removeEventListener('yourcomate:face-setting-changed', reload);
    };
  }, []);
  async function decide(decision) {
    setBusy(true);
    setError('');
    try {
      const r = await faceRequest('consent', {
        decision,
        revision: access.mine.revision,
        notice_version: access.notice_version,
      });
      setAccess({ ...access, mine: r.mine });
      setOpen(false);
    } catch (e) {
      setError(e.message);
      if (e.code === 'FACE_CONFLICT')
        faceRequest('access')
          .then(setAccess)
          .catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  if (!access?.can_manage && !access?.show_privacy) {
    return accessError ? (
      <p className="yf-error-text" role="alert">Facial attendance service: {accessError}</p>
    ) : null;
  }
  return (
    <>
      {access.can_manage && (
        <button
          type="button"
          className="secondary"
          onClick={() => setPage('face_attendance')}
        >
          <ScanFace size={16} /> Facial enrollment
        </button>
      )}
      {access.show_privacy && (
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setError('');
            setOpen(true);
          }}
        >
          <ShieldCheck size={16} /> Facial attendance privacy
        </button>
      )}
      {open && (
        <FaceDialog
          title="Facial attendance privacy"
          busy={busy}
          onClose={() => setOpen(false)}
        >
          <div className="yf-body">
            <p>
              Your organisation uses your encrypted facial template to verify
              your own check-in and checkout. Authorized staff in your
              organisation manage enrollment.
            </p>
            <p>
              Photographs and camera frames are processed in memory. The
              template expires after {access.retention_days} days.
              Administrative and exception records are kept for{' '}
              {access.audit_days} days.
            </p>
            <p>
              You can withdraw here to delete your active template. Contact HR
              for an attendance exception if you prefer an alternative.
            </p>
            <small>
              Notice {access.notice_version} ·{' '}
              {access.mine.consented ? 'Consent recorded' : 'Consent pending'}
            </small>
            {error && (
              <p className="yf-error-text" role="alert">
                {error}
              </p>
            )}
          </div>
          <footer className="yf-actions">
            <button disabled={busy} onClick={() => setOpen(false)}>
              Close
            </button>
            {access.mine.consented ? (
              <button
                disabled={busy}
                className="yf-danger"
                onClick={() => decide('withdraw')}
              >
                Withdraw and delete template
              </button>
            ) : (
              access.mode !== 'off' && (
                <button
                  disabled={busy}
                  className="yf-primary"
                  onClick={() => decide('accept')}
                >
                  I agree to facial attendance
                </button>
              )
            )}
          </footer>
        </FaceDialog>
      )}
    </>
  );
}
