import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const HORIZONTAL_QUERY = "(min-width: 761px) and (min-height: 560px)";
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function panelLabel(panel, index) {
  return (
    panel?.dataset.panelLabel ||
    panel?.querySelector("h1, h2, h3")?.textContent?.trim() ||
    `Section ${index + 1}`
  );
}

export default function PublicMotionLayer() {
  const location = useLocation();

  useEffect(() => {
    const site = document.querySelector(".public-site");
    const main = site?.querySelector(".public-main");

    if (!site || !main || location.pathname === "/") {
      site?.classList.remove("yc-standard-route");
      return undefined;
    }

    site.classList.add("yc-standard-route");

    const sections = Array.from(main.children).filter(
      (node) => node.nodeType === 1,
    );

    sections.forEach((section, index) => {
      section.classList.add("yc-perf-section");

      if (index === 0) {
        section.classList.add("yc-perf-in-view");
      }

      section.querySelectorAll("img").forEach((image) => {
        image.decoding = "async";

        if (index > 0 && !image.hasAttribute("loading")) {
          image.loading = "lazy";
        }
      });
    });

    if (typeof IntersectionObserver !== "function") {
      sections.forEach((section) => {
        section.classList.add("yc-perf-in-view");
      });

      return () => {
        site.classList.remove("yc-standard-route");
        sections.forEach((section) => {
          section.classList.remove("yc-perf-section", "yc-perf-in-view");
        });
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          entry.target.classList.toggle(
            "yc-perf-in-view",
            entry.isIntersecting,
          );
        });
      },
      {
        root: null,
        rootMargin: "320px 0px 320px",
        threshold: 0.01,
      },
    );

    sections.slice(1).forEach((section) => observer.observe(section));

    return () => {
      observer.disconnect();
      site.classList.remove("yc-standard-route");
      sections.forEach((section) => {
        section.classList.remove("yc-perf-section", "yc-perf-in-view");
      });
    };
  }, [location.pathname]);

  useEffect(() => {
    const site = document.querySelector(".public-site");
    const track = site?.querySelector(":scope > .public-scroll-track");
    const viewport = track?.querySelector(":scope > .public-horizontal-viewport");
    const shell = viewport?.querySelector(":scope > .public-horizontal-shell");
    const main = shell?.querySelector(":scope > .public-main");
    const media = window.matchMedia(HORIZONTAL_QUERY);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    if (!site || !track || !viewport || !shell || !main) return undefined;

    const panels = Array.from(main.children).filter((node) => node.nodeType === 1);
    const enabledForRoute =
      location.pathname === "/" && main.classList.contains("yc-horizontal-enabled");

    if (!enabledForRoute) return undefined;

    let desktop = false;
    let deckHeight = 1;
    let panelWidth = 1;
    let trackStart = 0;
    let maxTravel = 0;
    let currentProgress = 0;
    let targetProgress = 0;
    let activeIndex = -1;
    let animationFrame = 0;
    let measureFrame = 0;
    let resizeObserver = null;
    let lastFrameAt = performance.now();
    let touchPointerId = null;
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartScrollY = 0;
    let touchStartedAt = 0;
    let touchAxis = null;

    const emitState = (index) => {
      if (index === activeIndex) return;
      activeIndex = index;

      panels.forEach((panel, panelIndex) => {
        const active = panelIndex === index;
        panel.classList.toggle("is-active", active);
        panel.setAttribute("aria-hidden", active ? "false" : "true");
      });

      window.dispatchEvent(
        new CustomEvent("yc-page-deck-state", {
          detail: {
            index,
            count: panels.length,
            label: panels[index] ? panelLabel(panels[index], index) : "",
          },
        }),
      );
    };

    const applyProgress = (progress) => {
      currentProgress = clamp(progress, 0, Math.max(0, panels.length - 1));
      const translateX = -currentProgress * panelWidth;
      shell.style.transform = `translate3d(${translateX}px, 0, 0)`;

      const deckPercent =
        panels.length > 1 ? (currentProgress / (panels.length - 1)) * 100 : 0;
      site.style.setProperty("--yc-deck-progress-width", `${deckPercent}%`);

      emitState(
        clamp(Math.round(currentProgress), 0, Math.max(0, panels.length - 1)),
      );
    };

    const getDocumentProgress = () => {
      const localScroll = clamp(window.scrollY - trackStart, 0, maxTravel);
      return deckHeight > 0 ? localScroll / deckHeight : 0;
    };

    const render = (now) => {
      animationFrame = 0;
      if (!desktop) return;

      if (reducedMotion.matches) {
        applyProgress(targetProgress);
        return;
      }

      const elapsed = Math.min(42, Math.max(1, now - lastFrameAt));
      lastFrameAt = now;
      const response = 1 - Math.exp(-elapsed / 34);
      const nextProgress =
        currentProgress + (targetProgress - currentProgress) * response;

      if (Math.abs(targetProgress - nextProgress) <= 0.00035) {
        applyProgress(targetProgress);
        return;
      }

      applyProgress(nextProgress);
      animationFrame = window.requestAnimationFrame(render);
    };

    const requestRender = () => {
      if (animationFrame) return;
      lastFrameAt = performance.now();
      animationFrame = window.requestAnimationFrame(render);
    };

    const updateFromDocument = () => {
      if (!desktop || !media.matches) return;
      targetProgress = getDocumentProgress();
      requestRender();
    };

    const measure = () => {
      measureFrame = 0;
      if (!desktop || !media.matches) return;

      const header = document.querySelector(".public-site-header");
      const headerHeight = Math.ceil(
        header?.getBoundingClientRect().height || 0,
      );

      deckHeight = Math.max(1, window.innerHeight - headerHeight);
      panelWidth = Math.max(1, viewport.clientWidth || window.innerWidth);
      trackStart = track.getBoundingClientRect().top + window.scrollY - headerHeight;
      maxTravel = Math.max(0, (panels.length - 1) * deckHeight);

      site.style.setProperty("--yc-deck-height", `${deckHeight}px`);
      site.style.setProperty("--yc-deck-width", `${panelWidth}px`);
      site.style.setProperty("--yc-deck-count", String(panels.length));
      track.style.height = `${maxTravel + deckHeight}px`;
      main.style.width = `${panelWidth * panels.length}px`;

      targetProgress = getDocumentProgress();
      applyProgress(targetProgress);
    };

    const requestMeasure = () => {
      window.cancelAnimationFrame(measureFrame);
      measureFrame = window.requestAnimationFrame(measure);
    };

    const goToPanel = (index, behavior = "smooth") => {
      if (!desktop || !media.matches) return;

      const nextIndex = clamp(
        Number(index) || 0,
        0,
        Math.max(0, panels.length - 1),
      );

      window.scrollTo({
        top: trackStart + nextIndex * deckHeight,
        left: 0,
        behavior:
          behavior === "auto" || reducedMotion.matches ? "auto" : "smooth",
      });
    };

    const resetTouchGesture = () => {
      touchPointerId = null;
      touchStartX = 0;
      touchStartY = 0;
      touchStartScrollY = 0;
      touchStartedAt = 0;
      touchAxis = null;
    };

    const handlePointerDown = (event) => {
      if (
        !desktop ||
        !media.matches ||
        !["touch", "pen"].includes(event.pointerType) ||
        event.isPrimary === false
      ) {
        return;
      }

      const local = window.scrollY - trackStart;
      if (local < -1 || local > maxTravel + 1) return;

      touchPointerId = event.pointerId;
      touchStartX = event.clientX;
      touchStartY = event.clientY;
      touchStartScrollY = window.scrollY;
      touchStartedAt = performance.now();
      touchAxis = null;
      viewport.setPointerCapture?.(event.pointerId);
    };

    const handlePointerMove = (event) => {
      if (event.pointerId !== touchPointerId || !desktop || !media.matches) return;

      const deltaX = event.clientX - touchStartX;
      const deltaY = event.clientY - touchStartY;

      if (!touchAxis && Math.max(Math.abs(deltaX), Math.abs(deltaY)) >= 8) {
        touchAxis = Math.abs(deltaX) > Math.abs(deltaY) * 1.15
          ? "horizontal"
          : "vertical";
      }

      if (touchAxis !== "horizontal") return;

      event.preventDefault();
      const travelRatio = deckHeight / Math.max(1, panelWidth);
      const nextY = clamp(
        touchStartScrollY - deltaX * travelRatio,
        trackStart,
        trackStart + maxTravel,
      );

      window.scrollTo({ top: nextY, left: 0, behavior: "auto" });
    };

    const finishPointerGesture = (event) => {
      if (event.pointerId !== touchPointerId) return;

      const deltaX = event.clientX - touchStartX;
      const elapsed = Math.max(1, performance.now() - touchStartedAt);
      const velocity = Math.abs(deltaX) / elapsed;
      const wasHorizontal = touchAxis === "horizontal";

      viewport.releasePointerCapture?.(event.pointerId);
      resetTouchGesture();

      if (!wasHorizontal || !desktop || !media.matches) return;

      const progress = getDocumentProgress();
      let nextIndex = Math.round(progress);

      if (Math.abs(deltaX) >= Math.min(90, panelWidth * 0.12) || velocity >= 0.45) {
        nextIndex = deltaX < 0 ? Math.ceil(progress) : Math.floor(progress);
      }

      goToPanel(nextIndex);
    };

    const handlePointerCancel = (event) => {
      if (event.pointerId !== touchPointerId) return;
      viewport.releasePointerCapture?.(event.pointerId);
      resetTouchGesture();
    };

    const handleKeyDown = (event) => {
      if (
        !desktop ||
        !media.matches ||
        event.defaultPrevented ||
        event.target.closest?.("input, textarea, select, [contenteditable='true']")
      ) {
        return;
      }

      const local = window.scrollY - trackStart;
      if (local < -1 || local > maxTravel + 1) return;

      const index = clamp(
        Math.round(getDocumentProgress()),
        0,
        Math.max(0, panels.length - 1),
      );

      if (["ArrowRight", "PageDown"].includes(event.key)) {
        if (index >= panels.length - 1) return;
        event.preventDefault();
        goToPanel(index + 1);
      } else if (["ArrowLeft", "PageUp"].includes(event.key)) {
        event.preventDefault();
        goToPanel(index - 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        goToPanel(0);
      } else if (event.key === "End") {
        event.preventDefault();
        goToPanel(panels.length - 1);
      }
    };

    const handleGo = (event) => {
      goToPanel(event.detail?.index, event.detail?.behavior || "smooth");
    };

    const handleHash = (event) => {
      const hash = event.detail?.hash || location.hash;
      if (!hash) return;

      const target = document.querySelector(hash);
      const panel = target?.closest(".yc-page-panel");
      const index = panels.indexOf(panel);
      if (index >= 0) goToPanel(index, event.detail?.behavior || "smooth");
    };

    const clear = () => {
      desktop = false;
      window.cancelAnimationFrame(animationFrame);
      window.cancelAnimationFrame(measureFrame);
      resizeObserver?.disconnect();
      resizeObserver = null;
      animationFrame = 0;
      measureFrame = 0;

      document.documentElement.classList.remove("yc-horizontal-mode");
      document.body.classList.remove("yc-horizontal-mode");
      site.classList.remove("yc-deck-ready");
      site.style.removeProperty("--yc-deck-height");
      site.style.removeProperty("--yc-deck-width");
      site.style.removeProperty("--yc-deck-count");
      site.style.removeProperty("--yc-deck-progress-width");
      track.style.removeProperty("height");
      main.style.removeProperty("width");
      shell.style.removeProperty("transform");
      viewport.style.removeProperty("touch-action");
      resetTouchGesture();

      panels.forEach((panel) => {
        panel.classList.remove("yc-page-panel", "is-active");
        panel.removeAttribute("aria-hidden");
        panel.removeAttribute("data-panel-index");
      });

      currentProgress = 0;
      targetProgress = 0;
      activeIndex = -1;
    };

    const setup = () => {
      clear();

      if (!enabledForRoute || !media.matches || panels.length < 2) return;

      desktop = true;
      document.documentElement.classList.add("yc-horizontal-mode");
      document.body.classList.add("yc-horizontal-mode");
      site.classList.add("yc-deck-ready");
      viewport.style.touchAction = "pan-y";

      panels.forEach((panel, index) => {
        panel.classList.add("yc-page-panel");
        panel.dataset.panelIndex = String(index);
      });

      if (typeof ResizeObserver === "function") {
        resizeObserver = new ResizeObserver(requestMeasure);
        resizeObserver.observe(viewport);
        const header = document.querySelector(".public-site-header");
        if (header) resizeObserver.observe(header);
      }

      requestMeasure();
    };

    const handleViewportChange = () => {
      setup();
    };

    window.addEventListener("scroll", updateFromDocument, { passive: true });
    window.addEventListener("resize", handleViewportChange, { passive: true });
    window.addEventListener("orientationchange", handleViewportChange, { passive: true });
    window.addEventListener("keydown", handleKeyDown);
    viewport.addEventListener("pointerdown", handlePointerDown);
    viewport.addEventListener("pointermove", handlePointerMove, { passive: false });
    viewport.addEventListener("pointerup", finishPointerGesture);
    viewport.addEventListener("pointercancel", handlePointerCancel);
    window.addEventListener("yc-page-deck-go", handleGo);
    window.addEventListener("yc-scroll-to-hash", handleHash);
    media.addEventListener?.("change", handleViewportChange);
    reducedMotion.addEventListener?.("change", requestRender);

    setup();

    return () => {
      clear();
      window.removeEventListener("scroll", updateFromDocument);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("orientationchange", handleViewportChange);
      window.removeEventListener("keydown", handleKeyDown);
      viewport.removeEventListener("pointerdown", handlePointerDown);
      viewport.removeEventListener("pointermove", handlePointerMove);
      viewport.removeEventListener("pointerup", finishPointerGesture);
      viewport.removeEventListener("pointercancel", handlePointerCancel);
      window.removeEventListener("yc-page-deck-go", handleGo);
      window.removeEventListener("yc-scroll-to-hash", handleHash);
      media.removeEventListener?.("change", handleViewportChange);
      reducedMotion.removeEventListener?.("change", requestRender);
    };
  }, [location.pathname, location.hash]);

  return null;
}
