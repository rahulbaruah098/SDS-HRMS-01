import { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Check, ImagePlus, Info, ScanFace, Trash2 } from 'lucide-react';
import '../styles/face-enrollment-studio.css';

const CAPTURE_HINTS = [
  'Straight at the camera',
  'Head slightly turned left',
  'Head slightly turned right',
  'Different natural expression',
  'Another clear angle',
];

/** Local-only image preview and capture. Photos leave the browser only on Enroll. */
export default function FaceEnrollmentStudio({ photos, setPhotos, disabled, onUpload }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [cameraBusy, setCameraBusy] = useState(false);

  function stop() {
    if (streamRef.current) streamRef.current.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOpen(false);
    setCameraReady(false);
  }
  useEffect(() => () => {
    if (streamRef.current) streamRef.current.getTracks().forEach((track) => track.stop());
  }, []);
  useEffect(() => { if (disabled && cameraOpen) stop(); }, [disabled, cameraOpen]);

  function markCameraReady() {
    const video = videoRef.current;
    if (streamRef.current && video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
      setCameraReady(true);
    }
  }

  async function start() {
    if (disabled || cameraBusy) return;
    setCameraReady(false);
    setCameraError('');
    setCameraBusy(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera requires HTTPS or localhost and a supported browser.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setCameraOpen(true);
        await videoRef.current.play();
        markCameraReady();
      }
    } catch (e) {
      stop();
      setCameraError(e?.name === 'NotAllowedError' ? 'Camera permission denied. Allow access in your browser settings or upload photos.' : (e?.message || 'Unable to open camera.'));
    } finally { setCameraBusy(false); }
  }

  function capture() {
    if (disabled || !cameraOpen || !cameraReady || photos.length >= 5) return;
    const video = videoRef.current;
    if (!video?.videoWidth || !video?.videoHeight) {
      setCameraError('Camera is initializing. Try again.');
      return;
    }
    const scale = Math.min(1, 800 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(video.videoWidth * scale);
    canvas.height = Math.floor(video.videoHeight * scale);
    const context = canvas.getContext('2d');
    if (!context) { setCameraError('Canvas capture is unavailable.'); return; }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    setPhotos((prev) => prev.length >= 5 ? prev : [...prev, canvas.toDataURL('image/jpeg', 0.90)]);
    setCameraError('');
  }
  const sufficient = photos.length >= 3 && photos.length <= 5;
  return (
    <div className="yf-studio" aria-label="Employee face training studio">
      <div className="yf-studio-head">
        <div><ScanFace size={22}/><strong>Enrollment studio</strong><small>Register from 3–5 individual photographs</small></div>
        <span className={sufficient ? 'is-ready' : ''}>{photos.length} / 5 images</span>
      </div>
      <div className="yf-studio-progress" aria-label={`${photos.length} of 3 minimum photos`}>
        {Array.from({length:5},(_,i)=><span key={i} className={i<photos.length?'filled':''}/>) }
      </div>
      <div className="yf-studio-actions">
        <label className={`yf-studio-add ${disabled || photos.length >= 5 ? 'is-disabled':''}`}>
          <ImagePlus size={19}/> Upload images
          <input aria-label="Choose enrollment photographs" type="file" multiple accept="image/jpeg,image/png" onChange={onUpload} disabled={disabled || photos.length >= 5}/>
        </label>
        <button type="button" disabled={disabled || cameraBusy || photos.length >= 5 && !cameraOpen} onClick={cameraOpen ? stop : start}>
          {cameraOpen ? <CameraOff size={18}/> : <Camera size={18}/>}
          {cameraOpen ? 'Close camera' : cameraBusy ? 'Opening camera…' : 'Capture using camera'}
        </button>
      </div>
      <div className="yf-studio-camera" style={{display:cameraOpen?'block':'none'}}>
        <video ref={videoRef} muted playsInline autoPlay aria-label="Employee live camera preview" onLoadedData={markCameraReady} onPlaying={markCameraReady} />
        <div className="yf-studio-camera-bottom">
          <span>{cameraReady ? CAPTURE_HINTS[Math.min(photos.length,4)] : 'Initializing camera preview…'}</span>
          <button type="button" disabled={disabled || !cameraReady || photos.length >= 5} onClick={capture}><Camera size={16}/> Capture photo</button>
        </div>
      </div>
      {cameraError && <p className="yf-studio-error" role="alert">{cameraError}</p>}
      <div className="yf-studio-grid">
        {CAPTURE_HINTS.map((label,i)=>(
          <div className={`yf-studio-tile ${photos[i] ? 'has-photo' : ''}`} key={label}>
            {photos[i] ? <>
              <img src={photos[i]} alt={`Enrollment photo ${i+1}: ${label}`} />
              <button type="button" aria-label={`Remove view ${i+1}`} disabled={disabled} onClick={()=>setPhotos((items)=>items.filter((_,j)=>j!==i))}><Trash2 size={14}/></button>
              <span><Check size={13}/>{i+1}</span>
            </>:<><div className="yf-studio-placeholder"><Camera size={20}/></div><small>{i+1}. {label}</small></>}
          </div>
        ))}
      </div>
      <p className="yf-studio-help"><Info size={16}/>{sufficient
        ? 'Ready for model validation. Click Register face to train and securely save the template.'
        : 'Add at least three distinct photos of the consenting employee. Avoid group photos, blur and repeated identical frames.'}</p>
      <p className="yf-studio-privacy">Training happens only when you click Register face. Preview images are not saved to employee profiles.</p>
    </div>
  );
}
