import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import '../styles/face-attendance.css';

export default function FaceDialog({ title, children, onClose, busy = false }) {
  const dialog = useRef(null);
  const id = useId();
  useEffect(() => {
    const node = dialog.current;
    node.showModal();
    return () => node.close();
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="yc-face yf-dialog"
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="yf-head">
        <h2 id={id}>{title}</h2>
        <button
          type="button"
          className="yf-icon"
          disabled={busy}
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={18} />
        </button>
      </header>
      {children}
    </dialog>,
    document.body,
  );
}
