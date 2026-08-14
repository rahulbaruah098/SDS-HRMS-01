import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";

export default function ScrollToTopButton() {
  const [visible, setVisible] = useState(false);
  const deckIndexRef = useRef(0);

  useEffect(() => {
    const updateVisibility = () => {
      setVisible(window.scrollY > 120 || deckIndexRef.current > 0);
    };

    const handleState = (event) => {
      deckIndexRef.current = Number(event.detail?.index || 0);
      updateVisibility();
    };

    updateVisibility();
    window.addEventListener("scroll", updateVisibility, { passive: true });
    window.addEventListener("yc-page-deck-state", handleState);

    return () => {
      window.removeEventListener("scroll", updateVisibility);
      window.removeEventListener("yc-page-deck-state", handleState);
    };
  }, []);

  const returnToStart = () => {
    window.dispatchEvent(new CustomEvent("yc-page-deck-go", { detail: { index: 0 } }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <button
      className={`scroll-top-button ${visible ? "is-visible" : ""}`}
      type="button"
      aria-label="Return to the top of the website"
      title="Back to top"
      onClick={returnToStart}
    >
      <Icon name="arrowUp" />
    </button>
  );
}
