import { useEffect, useState } from "react";
import Icon from "./Icon";

export default function ScrollToTopButton() {
  const [visible, setVisible] = useState(false);
  const [deckIndex, setDeckIndex] = useState(0);

  useEffect(() => {
    const updateVisibility = () => {
      setVisible(window.scrollY > 120 || deckIndex > 0);
    };

    const handleState = (event) => {
      const nextIndex = Number(event.detail?.index || 0);
      setDeckIndex(nextIndex);
      setVisible(window.scrollY > 120 || nextIndex > 0);
    };

    updateVisibility();
    window.addEventListener("scroll", updateVisibility, { passive: true });
    window.addEventListener("yc-page-deck-state", handleState);

    return () => {
      window.removeEventListener("scroll", updateVisibility);
      window.removeEventListener("yc-page-deck-state", handleState);
    };
  }, [deckIndex]);

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
