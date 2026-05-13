import React, { useEffect, useMemo, useState } from 'react';
import {
  Gift,
  PartyPopper,
  Sparkles,
  X,
  CalendarHeart,
  Building2,
} from 'lucide-react';

function normalizeEventType(type) {
  return String(type || '').trim().toLowerCase();
}

function isBirthday(item) {
  return normalizeEventType(item?.event_type) === 'birthday';
}

function isAnniversary(item) {
  return normalizeEventType(item?.event_type) === 'work_anniversary';
}

function getCelebrationIcon(item) {
  if (isBirthday(item)) {
    return <PartyPopper size={34} />;
  }

  if (isAnniversary(item)) {
    return <CalendarHeart size={34} />;
  }

  return <Gift size={34} />;
}

function getDefaultTitle(item) {
  if (isBirthday(item)) {
    return `Happy Birthday, ${item.employee_name || 'Employee'}!`;
  }

  if (isAnniversary(item)) {
    const years = Number(item.year_count || 0);
    const label = years === 1 ? '1 Year' : `${years} Years`;
    return `Congratulations on ${label}!`;
  }

  return item.title || 'Celebration';
}

function getCelebrationLabel(item) {
  if (isBirthday(item)) {
    return 'Birthday Celebration';
  }

  if (isAnniversary(item)) {
    return 'Work Anniversary';
  }

  return 'Celebration';
}

function getCelebrationMessage(item) {
  if (item?.message) {
    return item.message;
  }

  if (isBirthday(item)) {
    return `Wishing you a very Happy Birthday!`;
  }

  if (isAnniversary(item)) {
    const years = Number(item.year_count || 0);
    const label = years === 1 ? '1 year' : `${years} years`;

    return `Congratulations on completing ${label} with the organization.`;
  }

  return '';
}

function getStorageKey(item) {
  return [
    'sds_hrms_celebration_seen',
    item?.id || item?._id || '',
    item?.date_key || '',
    item?.event_type || '',
    item?.employee_id || '',
  ].join('_');
}

function hasSeenCelebration(item) {
  try {
    return localStorage.getItem(getStorageKey(item)) === 'true';
  } catch {
    return false;
  }
}

function markCelebrationSeen(item) {
  try {
    localStorage.setItem(getStorageKey(item), 'true');
  } catch {
    // ignore localStorage errors
  }
}

export default function CelebrationPopup({ celebrations = [] }) {
  const eligibleCelebrations = useMemo(() => {
    return (Array.isArray(celebrations) ? celebrations : [])
      .filter(Boolean)
      .filter((item) => item.is_active !== false)
      .filter((item) => !hasSeenCelebration(item));
  }, [celebrations]);

  const [activeIndex, setActiveIndex] = useState(0);
  const [visible, setVisible] = useState(false);

  const activeCelebration = eligibleCelebrations[activeIndex];

  useEffect(() => {
    if (eligibleCelebrations.length) {
      setActiveIndex(0);
      setVisible(true);
    } else {
      setVisible(false);
    }
  }, [eligibleCelebrations.length]);

  if (!visible || !activeCelebration) {
    return null;
  }

  const tenantName =
    activeCelebration.highlight_name ||
    activeCelebration.tenant_name ||
    'The Organization';

  const title = activeCelebration.title || getDefaultTitle(activeCelebration);
  const label = getCelebrationLabel(activeCelebration);
  const message = getCelebrationMessage(activeCelebration);

  function closeCurrent() {
    markCelebrationSeen(activeCelebration);

    const nextIndex = activeIndex + 1;

    if (nextIndex < eligibleCelebrations.length) {
      setActiveIndex(nextIndex);
      return;
    }

    setVisible(false);
  }

  return (
    <div className="sds-celebration-overlay" role="dialog" aria-modal="true">
      <style>{`
        .sds-celebration-overlay {
          position: fixed;
          inset: 0;
          z-index: 9999;
          display: grid;
          place-items: center;
          padding: 20px;
          background:
            radial-gradient(circle at top left, rgba(255, 222, 89, 0.22), transparent 28%),
            radial-gradient(circle at bottom right, rgba(79, 70, 229, 0.24), transparent 32%),
            rgba(15, 23, 42, 0.56);
          backdrop-filter: blur(10px);
          animation: sdsCelebrationFadeIn 0.28s ease both;
        }

        .sds-celebration-card {
          position: relative;
          width: min(760px, 100%);
          overflow: hidden;
          border-radius: 32px;
          background:
            radial-gradient(circle at 18% 0%, rgba(255, 222, 89, 0.28), transparent 34%),
            radial-gradient(circle at 100% 12%, rgba(5, 150, 105, 0.16), transparent 32%),
            linear-gradient(145deg, #ffffff, #f8fafc);
          border: 1px solid rgba(255, 255, 255, 0.82);
          box-shadow: 0 30px 90px rgba(15, 23, 42, 0.32);
          animation: sdsCelebrationPop 0.42s cubic-bezier(.2,.9,.25,1.25) both;
        }

        .sds-celebration-close {
          position: absolute;
          top: 18px;
          right: 18px;
          z-index: 4;
          width: 42px;
          height: 42px;
          border: none;
          border-radius: 16px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: rgba(255, 255, 255, 0.84);
          color: #334155;
          cursor: pointer;
          box-shadow: 0 12px 28px rgba(15, 23, 42, 0.12);
          transition: transform 0.2s ease, background 0.2s ease;
        }

        .sds-celebration-close:hover {
          transform: translateY(-1px);
          background: #ffffff;
        }

        .sds-celebration-confetti {
          position: absolute;
          inset: 0;
          pointer-events: none;
          overflow: hidden;
        }

        .sds-confetti-piece {
          position: absolute;
          top: -20px;
          width: 10px;
          height: 18px;
          border-radius: 5px;
          opacity: 0.85;
          animation: sdsConfettiFall 3.8s linear infinite;
        }

        .sds-confetti-piece:nth-child(1) { left: 8%; background:#4f46e5; animation-delay:.1s; }
        .sds-confetti-piece:nth-child(2) { left: 18%; background:#ffde59; animation-delay:.7s; }
        .sds-confetti-piece:nth-child(3) { left: 28%; background:#059669; animation-delay:.25s; }
        .sds-confetti-piece:nth-child(4) { left: 42%; background:#0284c7; animation-delay:.95s; }
        .sds-confetti-piece:nth-child(5) { left: 56%; background:#e11d48; animation-delay:.45s; }
        .sds-confetti-piece:nth-child(6) { left: 68%; background:#ffde59; animation-delay:1.15s; }
        .sds-confetti-piece:nth-child(7) { left: 78%; background:#4f46e5; animation-delay:.35s; }
        .sds-confetti-piece:nth-child(8) { left: 90%; background:#059669; animation-delay:.85s; }

        .sds-celebration-body {
          position: relative;
          z-index: 2;
          padding: clamp(26px, 5vw, 52px);
          display: grid;
          gap: 22px;
          text-align: center;
        }

        .sds-celebration-badge {
          margin: 0 auto;
          width: fit-content;
          display: inline-flex;
          align-items: center;
          gap: 9px;
          padding: 9px 14px;
          border-radius: 999px;
          background: #eef2ff;
          color: #4f46e5;
          font-size: 13px;
          font-weight: 900;
          box-shadow: inset 0 0 0 1px rgba(79, 70, 229, 0.12);
        }

        .sds-celebration-icon {
          margin: 0 auto;
          width: 92px;
          height: 92px;
          border-radius: 30px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #ffffff;
          background:
            radial-gradient(circle at 30% 20%, rgba(255,255,255,.35), transparent 26%),
            linear-gradient(135deg, #4f46e5, #059669);
          box-shadow: 0 20px 40px rgba(79, 70, 229, 0.28);
          animation: sdsCelebrationFloat 2.4s ease-in-out infinite;
        }

        .sds-celebration-sparkle {
          position: absolute;
          color: #ffde59;
          animation: sdsSparkle 1.8s ease-in-out infinite;
        }

        .sds-celebration-sparkle.one {
          top: 92px;
          left: 13%;
        }

        .sds-celebration-sparkle.two {
          top: 140px;
          right: 14%;
          animation-delay: .45s;
        }

        .sds-celebration-title {
          margin: 0;
          color: #0f172a;
          font-size: clamp(28px, 5vw, 44px);
          line-height: 1.05;
          letter-spacing: -0.045em;
          font-weight: 950;
        }

        .sds-celebration-tenant {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          width: fit-content;
          margin: 0 auto;
          padding: 11px 15px;
          border-radius: 18px;
          background: #fff6d6;
          color: #1b4024;
          font-size: 15px;
          font-weight: 950;
          border: 1px solid rgba(255, 222, 89, 0.7);
        }

        .sds-celebration-message {
          margin: 0 auto;
          max-width: 610px;
          white-space: pre-line;
          color: #475569;
          font-size: 15.5px;
          line-height: 1.75;
        }

        .sds-celebration-person {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-wrap: wrap;
          gap: 10px;
          color: #64748b;
          font-size: 13px;
          font-weight: 750;
        }

        .sds-celebration-person span {
          padding: 8px 11px;
          border-radius: 999px;
          background: #f1f5f9;
          color: #334155;
        }

        .sds-celebration-actions {
          display: flex;
          justify-content: center;
          gap: 12px;
          flex-wrap: wrap;
        }

        .sds-celebration-btn {
          border: none;
          border-radius: 16px;
          padding: 13px 18px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          color: #ffffff;
          background: linear-gradient(135deg, #1b4024, #059669);
          box-shadow: 0 16px 32px rgba(5, 150, 105, 0.24);
          font-weight: 900;
          cursor: pointer;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }

        .sds-celebration-btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 20px 42px rgba(5, 150, 105, 0.3);
        }

        .sds-celebration-count {
          color: #94a3b8;
          font-size: 12px;
          font-weight: 800;
        }

        @keyframes sdsCelebrationFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes sdsCelebrationPop {
          from {
            opacity: 0;
            transform: translateY(18px) scale(.96);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        @keyframes sdsCelebrationFloat {
          0%, 100% { transform: translateY(0) rotate(-2deg); }
          50% { transform: translateY(-8px) rotate(2deg); }
        }

        @keyframes sdsSparkle {
          0%, 100% {
            opacity: .4;
            transform: scale(.8) rotate(0deg);
          }
          50% {
            opacity: 1;
            transform: scale(1.12) rotate(18deg);
          }
        }

        @keyframes sdsConfettiFall {
          0% {
            transform: translateY(-30px) rotate(0deg);
          }
          100% {
            transform: translateY(820px) rotate(360deg);
          }
        }

        @media (max-width: 640px) {
          .sds-celebration-overlay {
            padding: 14px;
          }

          .sds-celebration-card {
            border-radius: 26px;
          }

          .sds-celebration-icon {
            width: 78px;
            height: 78px;
            border-radius: 26px;
          }

          .sds-celebration-message {
            font-size: 14px;
          }

          .sds-celebration-btn {
            width: 100%;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .sds-celebration-overlay,
          .sds-celebration-card,
          .sds-celebration-icon,
          .sds-celebration-sparkle,
          .sds-confetti-piece {
            animation: none !important;
          }
        }
      `}</style>

      <div className="sds-celebration-card">
        <button
          type="button"
          className="sds-celebration-close"
          onClick={closeCurrent}
          aria-label="Close celebration"
        >
          <X size={20} />
        </button>

        <div className="sds-celebration-confetti" aria-hidden="true">
          <span className="sds-confetti-piece" />
          <span className="sds-confetti-piece" />
          <span className="sds-confetti-piece" />
          <span className="sds-confetti-piece" />
          <span className="sds-confetti-piece" />
          <span className="sds-confetti-piece" />
          <span className="sds-confetti-piece" />
          <span className="sds-confetti-piece" />
        </div>

        <Sparkles className="sds-celebration-sparkle one" size={28} />
        <Sparkles className="sds-celebration-sparkle two" size={24} />

        <div className="sds-celebration-body">
          <div className="sds-celebration-badge">
            <Sparkles size={15} />
            {label}
          </div>

          <div className="sds-celebration-icon">
            {getCelebrationIcon(activeCelebration)}
          </div>

          <h2 className="sds-celebration-title">{title}</h2>

          <div className="sds-celebration-tenant">
            <Building2 size={17} />
            {tenantName}
          </div>

          <p className="sds-celebration-message">{message}</p>

          <div className="sds-celebration-person">
            <span>{activeCelebration.employee_name || 'Employee'}</span>

            {activeCelebration.department ? (
              <span>{activeCelebration.department}</span>
            ) : null}

            {activeCelebration.designation ? (
              <span>{activeCelebration.designation}</span>
            ) : null}
          </div>

          <div className="sds-celebration-actions">
            <button
              type="button"
              className="sds-celebration-btn"
              onClick={closeCurrent}
            >
              <Gift size={18} />
              Continue
            </button>
          </div>

          {eligibleCelebrations.length > 1 ? (
            <div className="sds-celebration-count">
              {activeIndex + 1} of {eligibleCelebrations.length} celebrations
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}