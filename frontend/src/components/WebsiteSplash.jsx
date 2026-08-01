import { useEffect, useRef, useState } from "react";

const DESKTOP_SPLASH_VIDEO = "/videos/splash.mp4";
const APP_SPLASH_VIDEO = "/videos/app-splashscreen.mp4";

const DESKTOP_SPLASH_SESSION_KEY =
  "yourcomate_desktop_splash_seen_v1";
const APP_SPLASH_SESSION_KEY =
  "yourcomate_app_splash_seen_v1";

const FALLBACK_DURATION_MS = 9000;
const APP_VIEW_BREAKPOINT = 980;

function getSplashMode() {
  if (typeof window === "undefined") {
    return "desktop";
  }

  const isNarrowAppView = window.matchMedia(
    `(max-width: ${APP_VIEW_BREAKPOINT}px)`,
  ).matches;

  const isInstalledDisplayMode = window.matchMedia(
    "(display-mode: standalone)",
  ).matches;

  const isIosStandalone =
    window.navigator.standalone === true;

  return isNarrowAppView ||
    isInstalledDisplayMode ||
    isIosStandalone
    ? "app"
    : "desktop";
}

function getSplashConfiguration(mode) {
  if (mode === "app") {
    return {
      sessionKey: APP_SPLASH_SESSION_KEY,
      videoSource: APP_SPLASH_VIDEO,
    };
  }

  return {
    sessionKey: DESKTOP_SPLASH_SESSION_KEY,
    videoSource: DESKTOP_SPLASH_VIDEO,
  };
}

function hasSplashBeenSeen(sessionKey) {
  try {
    return window.sessionStorage.getItem(sessionKey) === "1";
  } catch {
    return false;
  }
}

function markSplashAsSeen(sessionKey) {
  try {
    window.sessionStorage.setItem(sessionKey, "1");
  } catch {
    // The splash still closes when browser storage is unavailable.
  }
}

export default function WebsiteSplash() {
  const [splashMode] = useState(getSplashMode);
  const splashConfiguration =
    getSplashConfiguration(splashMode);

  const [visible, setVisible] = useState(
    () =>
      !hasSplashBeenSeen(
        getSplashConfiguration(getSplashMode()).sessionKey,
      ),
  );

  const videoRef = useRef(null);
  const finishedRef = useRef(false);

  useEffect(() => {
    if (!visible) return undefined;

    document.documentElement.classList.add("yc-splash-open");
    document.body.classList.add("yc-splash-open");

    const finishSplash = () => {
      if (finishedRef.current) return;

      finishedRef.current = true;
      markSplashAsSeen(splashConfiguration.sessionKey);
      setVisible(false);
    };

    const fallbackTimer = window.setTimeout(
      finishSplash,
      FALLBACK_DURATION_MS,
    );

    const video = videoRef.current;

    if (video) {
      video.currentTime = 0;

      const playPromise = video.play();

      if (
        playPromise &&
        typeof playPromise.catch === "function"
      ) {
        playPromise.catch(() => {
          // The fallback timer closes the splash if autoplay is blocked.
        });
      }
    }

    return () => {
      window.clearTimeout(fallbackTimer);

      document.documentElement.classList.remove(
        "yc-splash-open",
      );
      document.body.classList.remove("yc-splash-open");
    };
  }, [
    splashConfiguration.sessionKey,
    visible,
  ]);

  if (!visible) return null;

  const finish = () => {
    if (finishedRef.current) return;

    finishedRef.current = true;
    markSplashAsSeen(splashConfiguration.sessionKey);
    setVisible(false);
  };

  return (
    <div
      className="yc-website-splash"
      data-splash-mode={splashMode}
      role="dialog"
      aria-modal="true"
      aria-label="YourComate introduction"
    >
      <video
        ref={videoRef}
        className="yc-website-splash-video"
        src={splashConfiguration.videoSource}
        autoPlay
        muted
        playsInline
        preload="auto"
        onEnded={finish}
        onError={finish}
      />

      <button
        type="button"
        className="yc-website-splash-skip"
        onClick={finish}
        aria-label="Skip introduction"
      >
        Skip
      </button>
    </div>
  );
}
