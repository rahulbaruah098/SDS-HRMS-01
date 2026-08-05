import { useEffect, useRef, useState } from "react";
import Brand from "./Brand";
import "../styles/website-splash.css";

const SPLASH_DURATION_MS = 3600;
const EXIT_DURATION_MS = 2000;
const GREETING_INTERVAL_MS = 280;
const FALLBACK_DURATION_MS =
  SPLASH_DURATION_MS + EXIT_DURATION_MS + 1200;

const GREETINGS = [
  "Welcome",
  "স্বাগতম",
  "സ്വാഗതം",
  "ಸ್ವಾಗತ",
  "खुलुमबाय",
  "स्वागत छ",
  "خوش آمدید",
  "欢迎",
  "ようこそ",
  "Bienvenido",
  "Bienvenue",
  "आपका स्वागत है",
];

const RIPPLE_POINTS = [
  {
    left: "28%",
    top: "34%",
    delay: "0s",
    duration: "8.8s",
    size: "320px",
  },
  {
    left: "72%",
    top: "66%",
    delay: "3.4s",
    duration: "10.2s",
    size: "380px",
  },
];

const BLOCKED_SCROLL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
]);

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function easeOutCubic(value) {
  return 1 - Math.pow(1 - value, 3);
}

function easeInOutCubic(value) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

export default function WebsiteSplash({ onComplete }) {
  const [visible, setVisible] = useState(true);
  const [greetingIndex, setGreetingIndex] = useState(0);
  const [percent, setPercent] = useState(0);
  const [exiting, setExiting] = useState(false);
  const [exitProgress, setExitProgress] = useState(0);

  const finishedRef = useRef(false);
  const exitStartedRef = useRef(false);
  const startExitRef = useRef(null);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (!visible) return undefined;

    const root = document.documentElement;
    const body = document.body;

    root.classList.add("yc-splash-open");
    body.classList.add("yc-splash-open");

    const preventScroll = (event) => {
      event.preventDefault();
    };

    const preventScrollKeys = (event) => {
      if (BLOCKED_SCROLL_KEYS.has(event.key)) {
        event.preventDefault();
      }
    };

    window.addEventListener("wheel", preventScroll, {
      passive: false,
    });
    window.addEventListener("touchmove", preventScroll, {
      passive: false,
    });
    window.addEventListener("keydown", preventScrollKeys, {
      passive: false,
    });

    const startedAt = performance.now();

    let counterFrame = 0;
    let exitFrame = 0;

    const completeSplash = () => {
      if (finishedRef.current) return;

      finishedRef.current = true;
      onCompleteRef.current?.();
      setVisible(false);
    };

    const runExit = () => {
      if (exitStartedRef.current || finishedRef.current) return;

      exitStartedRef.current = true;
      setExiting(true);

      const exitStartedAt = performance.now();

      const animateExit = (now) => {
        const linearProgress = clamp(
          (now - exitStartedAt) / EXIT_DURATION_MS,
          0,
          1,
        );

        setExitProgress(easeInOutCubic(linearProgress));

        if (linearProgress < 1) {
          exitFrame = window.requestAnimationFrame(animateExit);
          return;
        }

        completeSplash();
      };

      exitFrame = window.requestAnimationFrame(animateExit);
    };

    startExitRef.current = runExit;

    const animateCounter = (now) => {
      const linearProgress = clamp(
        (now - startedAt) / SPLASH_DURATION_MS,
        0,
        1,
      );

      setPercent(
        Math.round(easeOutCubic(linearProgress) * 100),
      );

      if (linearProgress < 1) {
        counterFrame =
          window.requestAnimationFrame(animateCounter);
        return;
      }

      setPercent(100);
      runExit();
    };

    counterFrame =
      window.requestAnimationFrame(animateCounter);

    const greetingTimer = window.setInterval(() => {
      setGreetingIndex((current) => {
        if (current >= GREETINGS.length - 1) {
          window.clearInterval(greetingTimer);
          return current;
        }

        return current + 1;
      });
    }, GREETING_INTERVAL_MS);

    const fallbackTimer = window.setTimeout(
      completeSplash,
      FALLBACK_DURATION_MS,
    );

    return () => {
      window.cancelAnimationFrame(counterFrame);
      window.cancelAnimationFrame(exitFrame);
      window.clearInterval(greetingTimer);
      window.clearTimeout(fallbackTimer);

      startExitRef.current = null;

      window.removeEventListener("wheel", preventScroll);
      window.removeEventListener("touchmove", preventScroll);
      window.removeEventListener("keydown", preventScrollKeys);

      root.classList.remove("yc-splash-open");
      body.classList.remove("yc-splash-open");
    };
  }, [visible]);

  if (!visible) return null;

  const skipSplash = () => {
    startExitRef.current?.();
  };

  /*
   * Keep the splash completely flat while loading.
   * Build the curve quickly during the first part of the exit, hold it
   * through most of the upward movement, then flatten it near the end.
   */
  const curveBuild = exiting
    ? clamp(exitProgress / 0.16, 0, 1)
    : 0;

  const curveFlatten = exiting
    ? clamp((1 - exitProgress) / 0.18, 0, 1)
    : 0;

  const curvePhase = curveBuild * curveFlatten;
  const curveDepth = 82 * curvePhase;
  const curveY = 1000 - curveDepth;

  const whiteCurveY = curveY - 4;
  const blueCurveY = curveY + 5;

  const splashPath = `
    M 0 0
    H 1000
    V ${curveY}
    Q 500 1000 0 ${curveY}
    Z
  `;

  const whiteSeamPath = `
    M 0 ${whiteCurveY}
    Q 500 ${996 - curveDepth * 0.03} 1000 ${whiteCurveY}
  `;

  const blueSeamPath = `
    M 0 ${blueCurveY}
    Q 500 ${1000 + curveDepth * 0.03} 1000 ${blueCurveY}
  `;

  const curveOpacity = exiting
    ? clamp(curveBuild * curveFlatten * 1.35, 0, 1)
    : 0;

  return (
    <div
      className={`yc-website-splash ${
        exiting ? "is-exiting" : ""
      }`}
      role="dialog"
      aria-modal="true"
      aria-label="YourComate introduction"
      style={{
        "--yc-splash-exit-progress": exitProgress,
        "--yc-splash-curve-opacity": curveOpacity,
      }}
    >
      <div
        className="yc-website-splash-sheet"
        aria-hidden="true"
      >
        <svg
          className="yc-website-splash-shape"
          viewBox="0 0 1000 1000"
          preserveAspectRatio="none"
          focusable="false"
        >
          <defs>
            <linearGradient
              id="ycSplashWater"
              x1="0%"
              y1="0%"
              x2="100%"
              y2="100%"
            >
              <stop offset="0%" stopColor="#11152d" />
              <stop offset="38%" stopColor="#17264a" />
              <stop offset="72%" stopColor="#233a68" />
              <stop offset="100%" stopColor="#2d2858" />
            </linearGradient>

            <radialGradient
              id="ycSplashGlow"
              cx="50%"
              cy="45%"
              r="68%"
            >
              <stop
                offset="0%"
                stopColor="#c7dcff"
                stopOpacity="0.14"
              />
              <stop
                offset="48%"
                stopColor="#8f9ee8"
                stopOpacity="0.08"
              />
              <stop
                offset="100%"
                stopColor="#11152d"
                stopOpacity="0"
              />
            </radialGradient>
          </defs>

          <path
            className="yc-website-splash-shape-fill"
            d={splashPath}
          />

          <path
            className="yc-website-splash-shape-glow"
            d={splashPath}
          />

          <path
            className="yc-website-splash-shape-seam-white"
            d={whiteSeamPath}
          />

          <path
            className="yc-website-splash-shape-seam-blue"
            d={blueSeamPath}
          />
        </svg>

        <div className="yc-website-splash-water-light" />

        <div className="yc-website-splash-ripples">
          {RIPPLE_POINTS.map((ripple) => (
            <span
              className="yc-website-splash-ripple"
              key={`${ripple.left}-${ripple.top}`}
              style={{
                "--yc-ripple-left": ripple.left,
                "--yc-ripple-top": ripple.top,
                "--yc-ripple-delay": ripple.delay,
                "--yc-ripple-duration": ripple.duration,
                "--yc-ripple-size": ripple.size,
              }}
            >
              <i />
              <i />
              <i />
            </span>
          ))}
        </div>

        <div className="yc-website-splash-logo">
          <Brand compact />
        </div>

        <div className="yc-website-splash-center">
          <div
            className="yc-website-splash-greeting"
            key={greetingIndex}
          >
            {GREETINGS[greetingIndex]}
          </div>
        </div>

        <div className="yc-website-splash-counter">
          <strong>{percent}</strong>
          <span>%</span>
        </div>
      </div>

      <button
        type="button"
        className="yc-website-splash-skip"
        onClick={skipSplash}
        aria-label="Skip introduction"
      >
        Skip
      </button>
    </div>
  );
}
