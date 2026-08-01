import { useEffect, useRef, useState } from "react";

const TURNSTILE_SCRIPT_ID = "cloudflare-turnstile-api";
const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const DUMMY_SITE_KEY = "1x00000000000000000000AA";

function loadTurnstileScript() {
  return new Promise((resolve, reject) => {
    if (window.turnstile) {
      resolve(window.turnstile);
      return;
    }

    let script = document.getElementById(TURNSTILE_SCRIPT_ID);

    const handleLoad = () => {
      if (window.turnstile) {
        resolve(window.turnstile);
      } else {
        reject(new Error("Cloudflare Turnstile did not initialise."));
      }
    };

    const handleError = () => {
      reject(new Error("Cloudflare Turnstile could not be loaded."));
    };

    if (!script) {
      script = document.createElement("script");
      script.id = TURNSTILE_SCRIPT_ID;
      script.src = TURNSTILE_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }

    script.addEventListener("load", handleLoad, { once: true });
    script.addEventListener("error", handleError, { once: true });
  });
}

export default function CloudflareTurnstile({
  onVerify,
  onExpire,
  resetKey = 0,
}) {
  const containerRef = useRef(null);
  const onVerifyRef = useRef(onVerify);
  const onExpireRef = useRef(onExpire);
  const [status, setStatus] = useState("loading");

  const siteKey =
    import.meta.env.VITE_CLOUDFLARE_TURNSTILE_SITE_KEY || DUMMY_SITE_KEY;

  useEffect(() => {
    onVerifyRef.current = onVerify;
    onExpireRef.current = onExpire;
  }, [onExpire, onVerify]);

  useEffect(() => {
    let cancelled = false;
    let widgetId = null;

    setStatus("loading");

    loadTurnstileScript()
      .then((turnstile) => {
        if (cancelled || !containerRef.current) return;

        widgetId = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: "light",
          size: "flexible",
          appearance: "always",
          callback: (token) => {
            setStatus("verified");
            onVerifyRef.current?.(token);
          },
          "expired-callback": () => {
            setStatus("expired");
            onExpireRef.current?.();
          },
          "error-callback": () => {
            setStatus("error");
            onExpireRef.current?.();
          },
        });
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;

      if (widgetId !== null && window.turnstile?.remove) {
        window.turnstile.remove(widgetId);
      }
    };
  }, [resetKey, siteKey]);

  return (
    <div className="yc-turnstile-field">
      <div ref={containerRef} className="yc-turnstile-widget" />

      <p className={`yc-turnstile-status is-${status}`} aria-live="polite">
        {status === "loading" && "Loading secure verification…"}
        {status === "verified" && "Verification complete."}
        {status === "expired" && "Verification expired. Please verify again."}
        {status === "error" &&
          "Verification could not load. Check the connection and retry."}
      </p>
    </div>
  );
}
