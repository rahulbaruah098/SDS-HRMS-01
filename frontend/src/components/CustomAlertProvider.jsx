import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const CustomAlertContext = createContext(null);

const DEFAULT_TITLES = {
  success: 'Success',
  error: 'Error',
  warning: 'Warning',
  info: 'Information',
};

const TYPE_ICONS = {
  success: '✓',
  error: '!',
  warning: '!',
  info: 'i',
};

function normalizeType(type) {
  if (['success', 'error', 'warning', 'info'].includes(type)) {
    return type;
  }

  return 'info';
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toMessageText(message) {
  if (message === null || message === undefined) return '';
  if (typeof message === 'string') return message;
  if (message?.message) return String(message.message);
  return String(message);
}

export function useCustomAlert() {
  const context = useContext(CustomAlertContext);

  if (!context) {
    throw new Error('useCustomAlert must be used inside CustomAlertProvider');
  }

  return context;
}

export default function CustomAlertProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);
  const timersRef = useRef({});

  const removeToast = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));

    if (timersRef.current[id]) {
      clearTimeout(timersRef.current[id]);
      delete timersRef.current[id];
    }
  }, []);

  const notify = useCallback(
    ({
      type = 'info',
      title,
      message,
      duration = 4200,
      sticky = false,
    } = {}) => {
      const safeType = normalizeType(type);
      const id = makeId();

      const toast = {
        id,
        type: safeType,
        title: title || DEFAULT_TITLES[safeType],
        message: toMessageText(message),
      };

      setToasts((current) => [toast, ...current].slice(0, 5));

      if (!sticky) {
        timersRef.current[id] = setTimeout(() => {
          removeToast(id);
        }, duration);
      }

      return id;
    },
    [removeToast],
  );

  const openDialog = useCallback((config) => {
    return new Promise((resolve) => {
      const safeType = normalizeType(config.type);

      setDialog({
        id: makeId(),
        type: safeType,
        title: config.title || DEFAULT_TITLES[safeType],
        message: toMessageText(config.message),
        confirmText: config.confirmText || 'OK',
        cancelText: config.cancelText || 'Cancel',
        showCancel: Boolean(config.showCancel),
        prompt: Boolean(config.prompt),
        promptValue: config.defaultValue || '',
        promptPlaceholder: config.placeholder || '',
        danger: Boolean(config.danger),
        resolve,
      });
    });
  }, []);

  const customAlert = useCallback(
    (message, options = {}) => {
      return openDialog({
        type: options.type || 'info',
        title: options.title || DEFAULT_TITLES[options.type || 'info'],
        message,
        confirmText: options.confirmText || 'OK',
        showCancel: false,
      });
    },
    [openDialog],
  );

  const customConfirm = useCallback(
    (message, options = {}) => {
      return openDialog({
        type: options.type || 'warning',
        title: options.title || 'Please Confirm',
        message,
        confirmText: options.confirmText || 'Yes, Continue',
        cancelText: options.cancelText || 'Cancel',
        showCancel: true,
        danger: Boolean(options.danger),
      });
    },
    [openDialog],
  );

  const customPrompt = useCallback(
    (message, options = {}) => {
      return openDialog({
        type: options.type || 'info',
        title: options.title || 'Input Required',
        message,
        confirmText: options.confirmText || 'Submit',
        cancelText: options.cancelText || 'Cancel',
        showCancel: true,
        prompt: true,
        defaultValue: options.defaultValue || '',
        placeholder: options.placeholder || '',
      });
    },
    [openDialog],
  );

  const closeDialog = useCallback((result) => {
    setDialog((current) => {
      if (current?.resolve) {
        current.resolve(result);
      }

      return null;
    });
  }, []);

  const updatePromptValue = useCallback((value) => {
    setDialog((current) => {
      if (!current) return current;

      return {
        ...current,
        promptValue: value,
      };
    });
  }, []);

  const success = useCallback(
    (message, title = 'Success') => notify({ type: 'success', title, message }),
    [notify],
  );

  const error = useCallback(
    (message, title = 'Error') => notify({ type: 'error', title, message, sticky: true }),
    [notify],
  );

  const warning = useCallback(
    (message, title = 'Warning') => notify({ type: 'warning', title, message }),
    [notify],
  );

  const info = useCallback(
    (message, title = 'Information') => notify({ type: 'info', title, message }),
    [notify],
  );

  const value = useMemo(
    () => ({
      notify,
      success,
      error,
      warning,
      info,
      alert: customAlert,
      confirm: customConfirm,
      prompt: customPrompt,
      removeToast,
    }),
    [
      notify,
      success,
      error,
      warning,
      info,
      customAlert,
      customConfirm,
      customPrompt,
      removeToast,
    ],
  );

  useEffect(() => {
    const nativeAlert = window.alert;

    window.customAlert = customAlert;
    window.customConfirm = customConfirm;
    window.customPrompt = customPrompt;

    window.alert = (message) => {
      customAlert(message, {
        type: 'info',
        title: 'Information',
      });
    };

    return () => {
      window.alert = nativeAlert;

      delete window.customAlert;
      delete window.customConfirm;
      delete window.customPrompt;

      Object.values(timersRef.current).forEach(clearTimeout);
      timersRef.current = {};
    };
  }, [customAlert, customConfirm, customPrompt]);

  return (
    <CustomAlertContext.Provider value={value}>
      {children}

      <div className="custom-alert-toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`custom-alert-toast custom-alert-${toast.type}`}
          >
            <div className="custom-alert-icon">
              {TYPE_ICONS[toast.type]}
            </div>

            <div className="custom-alert-toast-content">
              <strong>{toast.title}</strong>
              {toast.message ? <span>{toast.message}</span> : null}
            </div>

            <button
              type="button"
              className="custom-alert-close"
              onClick={() => removeToast(toast.id)}
              aria-label="Close alert"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {dialog ? (
        <div className="custom-alert-backdrop">
          <div
            className={`custom-alert-modal custom-alert-${dialog.type}`}
            role="dialog"
            aria-modal="true"
          >
            <div className="custom-alert-modal-icon">
              {TYPE_ICONS[dialog.type]}
            </div>

            <div className="custom-alert-modal-body">
              <h3>{dialog.title}</h3>

              {dialog.message ? <p>{dialog.message}</p> : null}

              {dialog.prompt ? (
                <textarea
                  value={dialog.promptValue}
                  onChange={(event) => updatePromptValue(event.target.value)}
                  placeholder={dialog.promptPlaceholder}
                  rows={4}
                  autoFocus
                />
              ) : null}

              <div className="custom-alert-modal-actions">
                {dialog.showCancel ? (
                  <button
                    type="button"
                    className="custom-alert-btn custom-alert-btn-light"
                    onClick={() => closeDialog(dialog.prompt ? null : false)}
                  >
                    {dialog.cancelText}
                  </button>
                ) : null}

                <button
                  type="button"
                  className={`custom-alert-btn ${
                    dialog.danger
                      ? 'custom-alert-btn-danger'
                      : 'custom-alert-btn-primary'
                  }`}
                  onClick={() => {
                    if (dialog.prompt) {
                      closeDialog(dialog.promptValue.trim());
                      return;
                    }

                    closeDialog(true);
                  }}
                >
                  {dialog.confirmText}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <style>{`
        .custom-alert-toast-stack {
          position: fixed;
          top: 22px;
          right: 22px;
          z-index: 99999;
          display: grid;
          gap: 12px;
          width: min(420px, calc(100vw - 32px));
          pointer-events: none;
        }

        .custom-alert-toast {
          pointer-events: auto;
          display: grid;
          grid-template-columns: 42px minmax(0, 1fr) 34px;
          align-items: start;
          gap: 12px;
          padding: 14px;
          border-radius: 20px;
          background: #FFFFFF;
          border: 1px solid #E2E8F0;
          box-shadow: 0 18px 45px rgba(15, 23, 42, 0.16);
          animation: customAlertSlideIn 0.22s ease-out;
        }

        .custom-alert-icon,
        .custom-alert-modal-icon {
          width: 38px;
          height: 38px;
          border-radius: 14px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-weight: 950;
          font-size: 18px;
          flex: 0 0 auto;
        }

        .custom-alert-toast-content {
          min-width: 0;
          display: grid;
          gap: 4px;
        }

        .custom-alert-toast-content strong {
          font-size: 14px;
          color: #0F172A;
          line-height: 1.25;
        }

        .custom-alert-toast-content span {
          font-size: 13px;
          color: #475569;
          line-height: 1.45;
          overflow-wrap: anywhere;
        }

        .custom-alert-close {
          width: 30px;
          height: 30px;
          border: 0;
          border-radius: 10px;
          background: #F8FAFC;
          color: #64748B;
          cursor: pointer;
          font-size: 20px;
          line-height: 1;
        }

        .custom-alert-close:hover {
          background: #E2E8F0;
          color: #0F172A;
        }

        .custom-alert-backdrop {
          position: fixed;
          inset: 0;
          z-index: 99998;
          background: rgba(15, 23, 42, 0.48);
          backdrop-filter: blur(6px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 18px;
        }

        .custom-alert-modal {
          width: min(480px, 100%);
          background: #FFFFFF;
          border: 1px solid #E2E8F0;
          border-radius: 28px;
          box-shadow: 0 28px 80px rgba(15, 23, 42, 0.28);
          padding: 24px;
          display: grid;
          grid-template-columns: 48px minmax(0, 1fr);
          gap: 16px;
          animation: customAlertPop 0.2s ease-out;
        }

        .custom-alert-modal-body {
          min-width: 0;
        }

        .custom-alert-modal h3 {
          margin: 0;
          color: #0F172A;
          font-size: 20px;
          font-weight: 950;
          letter-spacing: -0.02em;
        }

        .custom-alert-modal p {
          margin: 8px 0 0;
          color: #475569;
          font-size: 14px;
          line-height: 1.65;
          overflow-wrap: anywhere;
        }

        .custom-alert-modal textarea {
          margin-top: 14px;
          width: 100%;
          resize: vertical;
          border: 1px solid #CBD5E1;
          border-radius: 16px;
          padding: 12px 14px;
          color: #0F172A;
          font-size: 14px;
          line-height: 1.5;
          outline: none;
          background: #F8FAFC;
        }

        .custom-alert-modal textarea:focus {
          border-color: #4F46E5;
          box-shadow: 0 0 0 4px rgba(79, 70, 229, 0.13);
          background: #FFFFFF;
        }

        .custom-alert-modal-actions {
          margin-top: 20px;
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          flex-wrap: wrap;
        }

        .custom-alert-btn {
          border: 0;
          border-radius: 14px;
          min-height: 42px;
          padding: 0 16px;
          font-weight: 900;
          cursor: pointer;
          transition: 0.18s ease;
        }

        .custom-alert-btn-light {
          background: #F1F5F9;
          color: #334155;
          border: 1px solid #E2E8F0;
        }

        .custom-alert-btn-light:hover {
          background: #E2E8F0;
        }

        .custom-alert-btn-primary {
          background: linear-gradient(135deg, #4F46E5, #2563EB);
          color: #FFFFFF;
          box-shadow: 0 12px 26px rgba(37, 99, 235, 0.24);
        }

        .custom-alert-btn-primary:hover {
          transform: translateY(-1px);
          box-shadow: 0 16px 32px rgba(37, 99, 235, 0.3);
        }

        .custom-alert-btn-danger {
          background: linear-gradient(135deg, #DC2626, #B91C1C);
          color: #FFFFFF;
          box-shadow: 0 12px 26px rgba(220, 38, 38, 0.22);
        }

        .custom-alert-btn-danger:hover {
          transform: translateY(-1px);
          box-shadow: 0 16px 32px rgba(220, 38, 38, 0.28);
        }

        .custom-alert-success .custom-alert-icon,
        .custom-alert-success .custom-alert-modal-icon {
          background: #DCFCE7;
          color: #15803D;
        }

        .custom-alert-success {
          border-color: #BBF7D0;
        }

        .custom-alert-error .custom-alert-icon,
        .custom-alert-error .custom-alert-modal-icon {
          background: #FEE2E2;
          color: #B91C1C;
        }

        .custom-alert-error {
          border-color: #FECACA;
        }

        .custom-alert-warning .custom-alert-icon,
        .custom-alert-warning .custom-alert-modal-icon {
          background: #FEF3C7;
          color: #B45309;
        }

        .custom-alert-warning {
          border-color: #FDE68A;
        }

        .custom-alert-info .custom-alert-icon,
        .custom-alert-info .custom-alert-modal-icon {
          background: #E0F2FE;
          color: #0369A1;
        }

        .custom-alert-info {
          border-color: #BAE6FD;
        }

        @keyframes customAlertSlideIn {
          from {
            opacity: 0;
            transform: translateY(-10px) translateX(12px);
          }

          to {
            opacity: 1;
            transform: translateY(0) translateX(0);
          }
        }

        @keyframes customAlertPop {
          from {
            opacity: 0;
            transform: scale(0.96) translateY(8px);
          }

          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }

        @media (max-width: 640px) {
          .custom-alert-toast-stack {
            top: 14px;
            right: 14px;
            left: 14px;
            width: auto;
          }

          .custom-alert-toast {
            grid-template-columns: 38px minmax(0, 1fr) 32px;
            border-radius: 18px;
          }

          .custom-alert-modal {
            grid-template-columns: 1fr;
            border-radius: 24px;
            padding: 20px;
          }

          .custom-alert-modal-actions {
            justify-content: stretch;
          }

          .custom-alert-btn {
            flex: 1;
          }
        }
      `}</style>
    </CustomAlertContext.Provider>
  );
}