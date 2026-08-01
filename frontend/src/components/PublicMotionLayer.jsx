import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const DESKTOP_QUERY = "(min-width: 1121px) and (min-height: 700px)";
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
          section.classList.remove(
            "yc-perf-section",
            "yc-perf-in-view",
          );
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
        section.classList.remove(
          "yc-perf-section",
          "yc-perf-in-view",
        );
      });
    };
  }, [location.pathname]);

  useEffect(() => {
    const site = document.querySelector(".public-site");
    const track = site?.querySelector(":scope > .public-scroll-track");
    const viewport = track?.querySelector(":scope > .public-horizontal-viewport");
    const shell = viewport?.querySelector(":scope > .public-horizontal-shell");
    const main = shell?.querySelector(":scope > .public-main");
    const media = window.matchMedia(DESKTOP_QUERY);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    if (!site || !track || !viewport || !shell || !main) return undefined;

    const panels = Array.from(main.children).filter((node) => node.nodeType === 1);
    const enabledForRoute =
      location.pathname === "/" && main.classList.contains("yc-horizontal-enabled");

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

      // A short critically damped follow keeps wheel and trackpad input soft,
      // while remaining fast enough that the deck never feels detached.
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
      if (!desktop) return;

      targetProgress = getDocumentProgress();
      requestRender();
    };

    const measure = () => {
      measureFrame = 0;

      if (!desktop) return;

      const header = document.querySelector(".public-site-header");
      const headerHeight = Math.ceil(
        header?.getBoundingClientRect().height || 0,
      );

      deckHeight = Math.max(520, window.innerHeight - headerHeight);
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
      if (!desktop) return;

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

    const handleKeyDown = (event) => {
      if (
        !desktop ||
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

      panels.forEach((panel, index) => {
        panel.classList.add("yc-page-panel");
        panel.dataset.panelIndex = String(index);
      });

      resizeObserver = new ResizeObserver(requestMeasure);
      resizeObserver.observe(viewport);
      const header = document.querySelector(".public-site-header");
      if (header) resizeObserver.observe(header);

      requestMeasure();
    };

    const handleMediaChange = () => setup();

    window.addEventListener("scroll", updateFromDocument, { passive: true });
    window.addEventListener("resize", requestMeasure, { passive: true });
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("yc-page-deck-go", handleGo);
    window.addEventListener("yc-scroll-to-hash", handleHash);
    media.addEventListener?.("change", handleMediaChange);
    reducedMotion.addEventListener?.("change", requestRender);

    setup();

    return () => {
      clear();
      window.removeEventListener("scroll", updateFromDocument);
      window.removeEventListener("resize", requestMeasure);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("yc-page-deck-go", handleGo);
      window.removeEventListener("yc-scroll-to-hash", handleHash);
      media.removeEventListener?.("change", handleMediaChange);
      reducedMotion.removeEventListener?.("change", requestRender);
    };
  }, [location.pathname, location.hash]);

  return null;
}
