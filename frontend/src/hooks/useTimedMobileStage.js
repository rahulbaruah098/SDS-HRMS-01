import { useEffect, useRef, useState } from "react";

const MOBILE_QUERY = "(max-width: 900px)";

function isMobileViewport() {
  return (
    typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches
  );
}

export default function useTimedMobileStage(delay = 2200) {
  const timerRef = useRef(null);
  const [stage, setStage] = useState(() =>
    isMobileViewport() ? "intro" : "form",
  );

  useEffect(() => {
    if (!isMobileViewport()) {
      return undefined;
    }

    timerRef.current = window.setTimeout(() => {
      setStage("form");
      timerRef.current = null;
    }, delay);

    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, [delay]);

  const showStage = (nextStage) => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    setStage(nextStage);
  };

  return [stage, showStage];
}
