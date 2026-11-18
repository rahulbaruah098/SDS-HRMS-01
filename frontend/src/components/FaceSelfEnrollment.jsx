import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, RefreshCcw, ScanFace, ShieldCheck, X } from 'lucide-react';
import { faceRequest } from '../api/faceAttendance';
import '../styles/face-self-enrollment.css';

const guidance = [
  { title: 'Look straight ahead', note: 'Keep your face centered and look directly at the camera.' },
  { title: 'Turn slightly to your left', note: 'Turn only your head. Keep the camera still.' },
  { title: 'Turn slightly to your right', note: 'Move your head to the other side without moving the camera.' },
  { title: 'Look straight ahead again', note: 'Return to the center to finish the scan.' },
];
const RETRYABLE = ['face', 'camera', 'lighting', 'turn', 'head', 'guide', 'sharp', 'closer', 'still', 'one', 'straight', 'match'];

export default function FaceSelfEnrollment() {
  const [access, setAccess] = useState(null);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const [ready, setReady] = useState(false);
  const [reference, setReference] = useState('');
  const [frames, setFrames] = useState([]);
  const [step, setStep] = useState(-1);
  const [scanning, setScanning] = useState(false);
  const video = useRef(null);
  const stream = useRef(null);
  const timer = useRef(null);
  const session = useRef(0);
  const alive = useRef(true);
  const load = useCallback(() => faceRequest('access').then(setAccess).catch(e => setError(e.message)), []);
  const clearCamera = useCallback(() => {
    session.current += 1;
    clearTimeout(timer.current);
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  }, []);
  useEffect(() => {
    alive.current = true;
    load();
    return () => { alive.current = false; clearCamera(); };
  }, [clearCamera, load]);
  const stop = () => {
    clearCamera(); setCamera(false); setReady(false); setScanning(false); setStep(-1);
  };
  const resetScan = () => {
    session.current += 1; clearTimeout(timer.current);
    setScanning(false); setStep(-1); setFrames([]); setHint(''); setError('');
  };
  const refresh = async () => { await load(); window.dispatchEvent(new Event('face-enrollment-updated')); };
  async function consent() {
    setBusy(true); setError('');
    try { await faceRequest('consent', {revision: access.mine.revision, decision: 'accept', notice_version: access.notice_version}); await refresh(); }
    catch (e) { setError(e.message); await load(); }
    finally { setBusy(false); }
  }
  async function startCamera() {
    setError(''); setHint(''); setReference(''); setFrames([]); setStep(-1);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Error('Use HTTPS or localhost and grant camera access.');
      const s = await navigator.mediaDevices.getUserMedia({video: {facingMode: 'user', width: {ideal: 960}}, audio: false});
      stream.current = s; setReady(false); setCamera(true);
    } catch(e) { setError(e.message || 'Camera unavailable.'); }
  }
  useEffect(() => {
    if (!camera || !stream.current || !video.current) return;
    video.current.srcObject = stream.current;
    video.current.play().catch(() => setError('Camera playback failed. Check browser permissions.'));
  }, [camera]);
  function snap() {
    const el = video.current;
    if (!el?.videoWidth || !el?.videoHeight) throw Error('Camera is still initializing.');
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 640 / Math.max(el.videoWidth, el.videoHeight));
    canvas.width = Math.round(el.videoWidth * scale);
    canvas.height = Math.round(el.videoHeight * scale);
    canvas.getContext('2d').drawImage(el, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.76).split(',')[1];
  }
  function beginScan() {
    if (!reference || !ready || busy || scanning) return;
    resetScan();
    const run = session.current;
    const collected = [];
    setScanning(true); setStep(0);
    setHint('Hold still while your face position is checked automatically.');
    async function validateView(index) {
      if (!alive.current || run !== session.current || !stream.current) return;
      try {
        const frame = snap();
        const result = await faceRequest('self-enroll/check-view', {
          reference, frame, index, ...(index ? {baseline: collected[0]} : {}),
        });
        if (!alive.current || run !== session.current || !stream.current) return;
        if (!result?.valid || result.index !== index) throw Error('This view could not be verified.');
        collected.push(frame);
        setFrames([...collected]);
        setHint(index === 3 ? 'All views verified. You can submit for approval.' : 'View accepted. Follow the next direction.');
        if (index === 3) {
          setStep(-1); setScanning(false); return;
        }
        setStep(index + 1);
        // Give the employee time to move before testing the next view.
        timer.current = setTimeout(() => validateView(index + 1), 1400);
      } catch (e) {
        if (!alive.current || run !== session.current || !stream.current) return;
        const message = e.message || 'Hold still and try the current view again.';
        if (!RETRYABLE.some(word => message.toLowerCase().includes(word))) {
          setError(message); setScanning(false); setStep(index); return;
        }
        setHint(message);
        // Retry the SAME view; previously accepted frames are preserved.
        timer.current = setTimeout(() => validateView(index), 1450);
      }
    }
    timer.current = setTimeout(() => validateView(0), 1300);
  }
  async function submit() {
    if (!reference || frames.length !== guidance.length || scanning) return;
    setBusy(true); setError('');
    try {
      await faceRequest('self-enroll', {revision: access.mine.revision, reference, frames});
      stop(); setFrames([]); setReference(''); await refresh();
    } catch (e) {
      setError(e.message || 'Could not submit enrollment. Please review the scan.'); await load();
    } finally { setBusy(false); }
  }
  if (!access?.mine || access.mode === 'off') return null;
  const completed = frames.length === guidance.length && !scanning;
  return <section className="yc-face-self" aria-label="My facial enrollment">
    <header className="yc-face-self-heading"><ScanFace size={22}/><div><strong>Face verification</strong><p>Register with your camera. HR, Admin or IT Head will review your request.</p></div></header>
    {access.mine.approved ? <p className="yc-face-self-ok"><ShieldCheck size={18}/> Face verified and approved.</p>
      : access.mine.approval_status === 'pending' ? <p>Registration submitted. Waiting for HR / Admin / IT Head approval.</p>
      : <>
        <p className="yc-face-self-description">Take one frontal verification photo, then follow the live camera guidance. Each movement is verified before the next begins; an incorrect position only repeats that view.</p>
        {!access.mine.consented ? <div className="yc-face-self-consent"><p>By continuing, you consent to facial data being processed for attendance. Encrypted face templates are retained for up to {access.retention_days} days. Pending verification images are removed after review or expiry. You can withdraw via Attendance privacy. Ask HR for an alternative if needed.</p><button type="button" onClick={consent} disabled={busy}>I agree and enable face registration</button></div> : <>
          {!camera ? <button type="button" onClick={startCamera} disabled={busy}><Camera size={16}/> Open camera to register</button> : <div className="yc-face-self-workspace">
            <div className="yc-face-self-camera">
              <div className="yc-face-self-viewport">
                <video ref={video} muted playsInline autoPlay onLoadedData={() => setReady(true)} aria-label="Live face registration camera" />
                <div className="yc-face-self-oval" aria-hidden="true" />
                <span className="yc-face-self-live"><span/> Live camera</span>
                <span className="yc-face-self-step-label">{scanning && step >= 0 ? `View ${step + 1} of ${guidance.length}` : completed ? 'Scan complete' : 'Face enrollment'}</span>
              </div>
              <div className="yc-face-self-panel">
                <strong role="status" aria-live="polite">{scanning && step >= 0 ? guidance[step].title : completed ? 'All four views verified' : !ready ? 'Starting camera…' : !reference ? 'Look straight and capture your photo' : 'Ready for guided face scan'}</strong>
                <p>{scanning && step >= 0 ? guidance[step].note : completed ? 'Your scan is ready. Send it to HR, Admin or IT Head for approval.' : !reference ? 'Position your face inside the guide, with good lighting.' : 'Follow each instruction. Incorrect angles are retried without restarting.'}</p>
                {hint && <p className="yc-face-self-hint" role="status">{hint}</p>}
                <div className="yc-face-self-progress" aria-label={`${frames.length} of ${guidance.length} views verified`}>
                  {guidance.map((item, index) => <span key={item.title} className={index < frames.length ? 'done' : scanning && index === step ? 'active' : ''} title={item.title}>{index < frames.length ? <CheckCircle2 size={14}/> : index + 1}</span>)}
                </div>
                <div className="yc-face-self-actions">
                  {!reference && <button type="button" disabled={!ready || busy} onClick={() => {try {setReference(snap());setError('');}catch(e){setError(e.message);}}}>Capture verification photo</button>}
                  {reference && !scanning && !completed && <button type="button" disabled={!ready || busy} onClick={beginScan}><ScanFace size={16}/> {frames.length ? 'Retry guided scan' : 'Start guided face scan'}</button>}
                  {completed && <button type="button" disabled={busy} onClick={submit}>{busy ? 'Submitting…' : 'Submit for approval'}</button>}
                  {reference && !scanning && <button type="button" className="yc-face-self-light" disabled={busy} onClick={() => {resetScan();setReference('');}}>Retake photo</button>}
                  <button type="button" className="yc-face-self-light" onClick={() => {stop();setReference('');setFrames([]);setHint('');setError('');}} disabled={busy}><X size={15}/> Close camera</button>
                </div>
                {reference && <small>Verification photo captured · {frames.length}/{guidance.length} guided views accepted</small>}
              </div>
            </div>
          </div>}
        </>}
      </>}
    {error && <div className="yc-face-self-error" role="alert"><span>{error}</span> {camera && !scanning && reference && frames.length < guidance.length && <button type="button" onClick={() => {setError('');beginScan();}}><RefreshCcw size={14}/> Resume scan</button>}</div>}
  </section>;
}
