import { useEffect, useRef, useState } from 'react';
import { Check, Camera, ScanFace, RotateCcw } from 'lucide-react';
import { faceRequest } from '../api/faceAttendance';
import FaceDialog from './FaceDialog';

const instructions = {
  center: 'Look straight ahead',
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function capture(video) {
  if (!video.videoWidth || !video.videoHeight) return null;
  const scale = Math.min(
    1,
    720 / Math.max(video.videoWidth, video.videoHeight),
  );
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.87).split(',')[1];
}
function explanation(e) {
  if (e.name === 'NotAllowedError')
    return 'Allow camera access in your browser’s site settings, then try again.';
  if (e.name === 'NotFoundError')
    return 'Connect a camera or contact HR for an alternative.';
  if (e.name === 'NotReadableError')
    return 'Close other apps using the camera, then try again.';
  return e.message || 'The scan could not finish. Please try again.';
}
export default function FaceCamera({ action, onFinish }) {
  const video = useRef(null);
  const finish = useRef(onFinish);
  finish.current = onFinish;
  const abandon = useRef(() => {});
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({
    phase: 'opening',
    message: 'Preparing your scan…',
  });
  useEffect(() => {
    let active = true,
      stream,
      token;
    const player = video.current;
    function stopCamera() {
      const owned = stream;
      stream = null;
      owned?.getTracks().forEach((t) => t.stop());
      if (player.srcObject === owned) player.srcObject = null;
    }
    function dropChallenge() {
      if (token) faceRequest('cancel', { challenge: token }).catch(() => {});
      token = null;
    }
    function stop() {
      active = false;
      stopCamera();
      dropChallenge();
    }
    abandon.current = stop;
    const leave = () => {
      stop();
      finish.current(null);
    };
    const visibility = () => {
      if (document.hidden) leave();
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', leave);
    async function scan() {
      await Promise.resolve();
      if (!active) return;
      setState({ phase: 'opening', message: 'Preparing your scan…' });
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
          throw new Error(
            'Open YourComate over HTTPS or localhost to use the camera.',
          );
        let stage = await faceRequest('challenge', { action });
        token = stage.challenge;
        if (!active) {
          dropChallenge();
          return;
        }
        setState({
          phase: 'opening',
          message: 'Allow camera access to begin.',
        });
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'user' },
            width: { ideal: 720 },
            height: { ideal: 540 },
          },
        });
        if (!active) {
          stopCamera();
          return;
        }
        player.srcObject = stream;
        await player.play();
        let hint = '';
        const deadline = Date.now() + 85000;
        while (active && Date.now() < deadline) {
          setState({
            phase: 'scanning',
            message: instructions[stage.prompt],
            hint,
            step: stage.step,
            steps: stage.steps || 2,
          });
          await wait(820);
          if (!active) return;
          const frame = capture(player);
          if (!frame) continue;
          try {
            const next = await faceRequest('frame', {
              challenge: token,
              step: stage.step,
              frame,
            });
            if (!active) return;
            if (next.proof) {
              token = null;
              stopCamera();
              setState({
                phase: 'matched',
                message: 'Identity verified',
                hint: 'Continuing to the attendance checks…',
              });
              await wait(460);
              if (active) finish.current(next.proof);
              return;
            }
            stage = next;
            hint = '';
          } catch (e) {
            if (
              !['FACE_QUALITY', 'FACE_POSITION', 'FACE_POSE'].includes(e.code)
            )
              throw e;
            hint = e.message;
          }
        }
        if (active)
          throw new Error(
            'This scan timed out. Start another when you are ready.',
          );
      } catch (e) {
        if (active) {
          stopCamera();
          dropChallenge();
          setState({
            phase: 'error',
            message: 'Scan incomplete',
            hint: explanation(e),
          });
        }
      }
    }
    scan();
    return () => {
      stop();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', leave);
    };
  }, [action, attempt]);
  function cancel() {
    abandon.current();
    finish.current(null);
  }
  return (
    <FaceDialog
      title={action === 'check-in' ? 'Verify check-in' : 'Verify checkout'}
      onClose={cancel}
    >
      <div className={`yf-view yf-${state.phase}`}>
        <video
          ref={video}
          autoPlay
          playsInline
          muted
          aria-label="Live camera preview"
        />
        <div className="yf-guide">
          <i className="yf-sweep" />
          <span className="yf-pulse-outline" aria-hidden="true" />
          <span className="yf-corner yf-corner-tl" aria-hidden="true" />
          <span className="yf-corner yf-corner-tr" aria-hidden="true" />
          <span className="yf-corner yf-corner-bl" aria-hidden="true" />
          <span className="yf-corner yf-corner-br" aria-hidden="true" />
        </div>
        <div className="yf-mark">
          {state.phase === 'matched' ? (
            <Check />
          ) : state.phase === 'opening' ? (
            <ScanFace />
          ) : state.phase === 'error' ? (
            <Camera />
          ) : null}
        </div>
        {state.phase === 'scanning' && (
          <span className="yf-step">Checking face · {state.step + 1} of {state.steps || 2}</span>
        )}
      </div>
      <div className="yf-scan-state" aria-hidden="true">
        <span className={state.phase === 'matched' ? 'yf-state-dot is-done' : 'yf-state-dot'} />
        <span className={state.phase === 'matched' ? 'yf-state-line is-done' : 'yf-state-line'} />
      </div>
      <div className="yf-camera-copy" role="status" aria-live="polite">
        <strong>{state.message}</strong>
        <p>
          {state.hint ||
            'Keep one face in the guide and hold the camera still.'}
        </p>
      </div>
      <footer className="yf-actions">
        <button onClick={cancel}>Cancel</button>
        {state.phase === 'error' && (
          <button
            className="yf-primary"
            onClick={() => setAttempt((n) => n + 1)}
          >
            <RotateCcw size={15} /> Try again
          </button>
        )}
      </footer>
    </FaceDialog>
  );
}
