import { useEffect, useRef } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigationType,
} from "react-router-dom";
import CookieConsentBanner from "./components/CookieConsentBanner";
import WebsiteSplash from "./components/WebsiteSplash";
import PolicyConsentModal from "./components/PolicyConsentModal";
import PublicLayout from "./layouts/PublicLayout";
import AboutPage from "./pages/AboutPage";
import AboutSayanantPage from "./pages/AboutSayanantPage";
import ContactPage from "./pages/ContactPage";
import CustomersPage from "./pages/CustomersPage";

import FeaturePage from "./pages/FeaturePage";
import HomePage from "./pages/HomePage";
import LegalPage from "./pages/LegalPage";

import PricingPage from "./pages/PricingPage";
import ProductPage from "./pages/ProductPage";
import ResourceDetailPage from "./pages/ResourceDetailPage";
import ResourcesPage from "./pages/ResourcesPage";
import SayaPage from "./pages/SayaPage";
import SecurityPage from "./pages/SecurityPage";
import SupportPage from "./pages/SupportPage";

const SCROLL_STORAGE_KEY = "yourcomate_scroll_positions_v1";
const MAX_SAVED_POSITIONS = 60;
const RESTORE_TIMEOUT_MS = 1800;

function getRouteSignature(location) {
  return `${location.pathname}${location.search}${location.hash}`;
}

function readScrollPositions() {
  try {
    const saved = JSON.parse(
      window.sessionStorage.getItem(SCROLL_STORAGE_KEY) || "{}",
    );

    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

function writeScrollPosition(entryKey, signature, position) {
  if (!entryKey) return;

  try {
    const positions = readScrollPositions();

    positions[entryKey] = {
      signature,
      x: Math.max(0, Math.round(position.x || 0)),
      y: Math.max(0, Math.round(position.y || 0)),
      savedAt: Date.now(),
    };

    const orderedEntries = Object.entries(positions).sort(
      ([, first], [, second]) =>
        Number(second?.savedAt || 0) - Number(first?.savedAt || 0),
    );

    const limitedPositions = Object.fromEntries(
      orderedEntries.slice(0, MAX_SAVED_POSITIONS),
    );

    window.sessionStorage.setItem(
      SCROLL_STORAGE_KEY,
      JSON.stringify(limitedPositions),
    );
  } catch {
    // Scroll restoration is progressive enhancement. Navigation must still
    // work when browser storage is unavailable.
  }
}

function readScrollPosition(entryKey, signature) {
  const saved = readScrollPositions()[entryKey];

  if (!saved || saved.signature !== signature) return null;

  return {
    x: Number(saved.x) || 0,
    y: Number(saved.y) || 0,
  };
}

function scrollImmediately(x, y) {
  const root = document.documentElement;
  const previousScrollBehavior = root.style.scrollBehavior;

  root.style.scrollBehavior = "auto";
  window.scrollTo({
    left: Math.max(0, x),
    top: Math.max(0, y),
    behavior: "auto",
  });
  root.style.scrollBehavior = previousScrollBehavior;
}

function restorePositionWhenReady(position) {
  let animationFrame = 0;
  let cancelled = false;
  let stableFrames = 0;
  const startedAt = performance.now();

  const restore = () => {
    if (cancelled) return;

    const documentHeight = Math.max(
      document.documentElement.scrollHeight,
      document.body?.scrollHeight || 0,
    );
    const maximumY = Math.max(0, documentHeight - window.innerHeight);
    const canReachSavedPosition = maximumY + 2 >= position.y;
    const targetY = Math.min(position.y, maximumY);

    scrollImmediately(position.x, targetY);

    const restored =
      Math.abs(window.scrollX - position.x) <= 2 &&
      Math.abs(window.scrollY - targetY) <= 2;

    stableFrames = canReachSavedPosition && restored
      ? stableFrames + 1
      : 0;

    const timedOut =
      performance.now() - startedAt >= RESTORE_TIMEOUT_MS;

    if (stableFrames >= 3 || timedOut) {
      if (timedOut) {
        scrollImmediately(position.x, targetY);
      }
      return;
    }

    animationFrame = window.requestAnimationFrame(restore);
  };

  animationFrame = window.requestAnimationFrame(restore);

  return () => {
    cancelled = true;
    window.cancelAnimationFrame(animationFrame);
  };
}

function scrollToHashWhenReady(hash) {
  let animationFrame = 0;
  let attempts = 0;
  let cancelled = false;

  const scrollToHash = () => {
    if (cancelled) return;

    attempts += 1;

    if (document.body.classList.contains("yc-horizontal-mode")) {
      window.dispatchEvent(
        new CustomEvent("yc-scroll-to-hash", {
          detail: {
            hash,
            behavior: "auto",
          },
        }),
      );
      return;
    }

    const target = document.querySelector(hash);

    if (target) {
      const root = document.documentElement;
      const previousScrollBehavior = root.style.scrollBehavior;

      root.style.scrollBehavior = "auto";
      target.scrollIntoView({
        behavior: "auto",
        block: "start",
      });
      root.style.scrollBehavior = previousScrollBehavior;
      return;
    }

    if (attempts < 90) {
      animationFrame = window.requestAnimationFrame(scrollToHash);
    }
  };

  animationFrame = window.requestAnimationFrame(scrollToHash);

  return () => {
    cancelled = true;
    window.cancelAnimationFrame(animationFrame);
  };
}

function ScrollManager() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const activeEntryRef = useRef(null);
  const lastPositionRef = useRef({
    x: window.scrollX,
    y: window.scrollY,
  });

  useEffect(() => {
    const previousRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";

    return () => {
      window.history.scrollRestoration = previousRestoration;
    };
  }, []);

  /*
   * Continuously remember the latest position independently from route
   * rendering. This prevents responsive or horizontal pages from shortening
   * before their outgoing position has been saved.
   */
  useEffect(() => {
    let positionFrame = 0;

    const rememberCurrentPosition = () => {
      if (positionFrame) return;

      positionFrame = window.requestAnimationFrame(() => {
        positionFrame = 0;

        lastPositionRef.current = {
          x: window.scrollX,
          y: window.scrollY,
        };
      });
    };

    const saveActivePosition = () => {
      const activeEntry = activeEntryRef.current;

      if (!activeEntry) return;

      const currentPosition = {
        x: window.scrollX,
        y: window.scrollY,
      };

      lastPositionRef.current = currentPosition;

      writeScrollPosition(
        activeEntry.entryKey,
        activeEntry.signature,
        currentPosition,
      );
    };

    const saveBeforeInternalNavigation = (event) => {
      if (
        event.type === "pointerdown" &&
        typeof event.button === "number" &&
        event.button !== 0
      ) {
        return;
      }

      if (
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target =
        event.target instanceof Element
          ? event.target
          : null;
      const link = target?.closest("a[href]");

      if (!link || link.hasAttribute("download")) return;

      const linkTarget = link.getAttribute("target");

      if (linkTarget && linkTarget !== "_self") return;

      let destination;

      try {
        destination = new URL(
          link.getAttribute("href"),
          window.location.href,
        );
      } catch {
        return;
      }

      if (destination.origin !== window.location.origin) return;

      /*
       * Save synchronously before React Router begins replacing the page.
       * pointerdown handles mouse/touch; click also handles keyboard links.
       */
      saveActivePosition();
    };

    window.addEventListener(
      "scroll",
      rememberCurrentPosition,
      { passive: true },
    );
    document.addEventListener(
      "pointerdown",
      saveBeforeInternalNavigation,
      true,
    );
    document.addEventListener(
      "click",
      saveBeforeInternalNavigation,
      true,
    );

    return () => {
      window.cancelAnimationFrame(positionFrame);

      window.removeEventListener(
        "scroll",
        rememberCurrentPosition,
      );
      document.removeEventListener(
        "pointerdown",
        saveBeforeInternalNavigation,
        true,
      );
      document.removeEventListener(
        "click",
        saveBeforeInternalNavigation,
        true,
      );
    };
  }, []);

  useEffect(() => {
    const entryKey =
      location.key || window.history.state?.key || "default";
    const signature = getRouteSignature(location);

    activeEntryRef.current = {
      entryKey,
      signature,
    };

    /*
     * Initialise tracking for the newly active history entry. Any restored
     * position below is then captured again by the global scroll listener.
     */
    lastPositionRef.current = {
      x: window.scrollX,
      y: window.scrollY,
    };

    const saveCurrentPosition = () => {
      const activeEntry = activeEntryRef.current;

      if (!activeEntry) return;

      writeScrollPosition(
        activeEntry.entryKey,
        activeEntry.signature,
        lastPositionRef.current,
      );
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        lastPositionRef.current = {
          x: window.scrollX,
          y: window.scrollY,
        };
        saveCurrentPosition();
      }
    };

    const handlePageHide = () => {
      lastPositionRef.current = {
        x: window.scrollX,
        y: window.scrollY,
      };
      saveCurrentPosition();
    };

    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange,
    );

    let cancelScheduledScroll = () => {};

    if (navigationType === "POP") {
      const savedPosition = readScrollPosition(entryKey, signature);

      if (savedPosition) {
        /*
         * Only browser Back/Forward navigation needs delayed restoration,
         * because the page may still be rendering when the saved position
         * is applied.
         */
        scrollImmediately(savedPosition.x, savedPosition.y);
        cancelScheduledScroll =
          restorePositionWhenReady(savedPosition);
      } else if (location.hash) {
        cancelScheduledScroll =
          scrollToHashWhenReady(location.hash);
      } else {
        scrollImmediately(0, 0);
      }
    } else if (location.hash) {
      cancelScheduledScroll =
        scrollToHashWhenReady(location.hash);
    } else {
      /*
       * A normal Link navigation only needs one reset.
       * Do not repeatedly force the window back to the top, because that
       * blocks wheel and trackpad scrolling while the new page is loading.
       */
      scrollImmediately(0, 0);
    }
    return () => {
      /*
       * Use the last remembered value rather than reading a page whose
       * responsive/horizontal layout may already be unmounting.
       */
      saveCurrentPosition();
      cancelScheduledScroll();

      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );
    };
  }, [
    location.hash,
    location.key,
    location.pathname,
    location.search,
    navigationType,
  ]);

  return null;
}

export default function WebsiteApp() {
  return (
    <>
      <WebsiteSplash />
      <ScrollManager />
      <Routes>
        <Route element={<PublicLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/product" element={<ProductPage />} />
          <Route path="/product/:featureKey" element={<FeaturePage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/resources" element={<ResourcesPage />} />
          <Route path="/resources/:resourceKey" element={<ResourceDetailPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/about-sayanant" element={<AboutSayanantPage />} />
          <Route path="/security" element={<SecurityPage />} />
          <Route path="/support" element={<SupportPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/saya" element={<SayaPage />} />
          <Route path="/privacy" element={<LegalPage pageKey="privacy" />} />
          <Route path="/terms" element={<LegalPage pageKey="terms" />} />
          <Route path="/cookies" element={<LegalPage pageKey="cookies" />} />
          <Route path="/accessibility" element={<LegalPage pageKey="accessibility" />} />
          <Route path="/disclaimer" element={<LegalPage pageKey="disclaimer" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <CookieConsentBanner />
      <PolicyConsentModal />
    </>
  );
}
