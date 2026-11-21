import { useEffect, useState } from 'react';
import { BadgeCheck } from 'lucide-react';
import { faceRequest } from '../api/faceAttendance';
import '../styles/face-self-enrollment.css';
export default function FaceVerifiedBadge() {
  const [verified, setVerified] = useState(false);
  useEffect(() => {
    let live = true;
    const refresh = () => faceRequest('access').then(r => { if (live) setVerified(Boolean(r.mine?.approved)); }).catch(() => {});
    refresh();
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 45000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('face-enrollment-updated', refresh);
    return () => {
      live = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('face-enrollment-updated', refresh);
    };
  }, []);
  return verified ? <span className="yc-face-verified" title="Face enrollment approved" aria-label="Face verified"><BadgeCheck size={21} strokeWidth={2.5}/></span> : null;
}
