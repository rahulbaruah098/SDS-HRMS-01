import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import WebsiteApp from "./WebsiteApp";

import "./styles/index.css";
import "./styles/integrated-route-scroll.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element #root not found");
}

const HRMS_PREFIX = "/hrms";

const HRMS_PUBLIC_ROUTES = [
  "/login",
  "/account-access-help",
  "/account-access-track",
  "/apply-trial-registration",
  "/trial-registration",
  "/register-trial",
  "/apply-demo-registration",
  "/demo-registration",
  "/register-demo",
  "/careers",
];

const HRMS_LEGACY_ROUTES = [
  "/billing",
  "/upgrade",
  "/subscription",
  "/subscribe",
  "/payment",
  "/plans",
  "/premium-requests",
  "/premium-request",
  "/premium-plan-requests",
  "/custom-premium-requests",
  "/sales-requests",
  "/subscription-expired",
  "/trial-expired",
  "/trial-ended",
  "/upgrade-required",
  "/demo-expired",
];

const HISTORY_PATCH_FLAG = "__yourcomateNavigationEventsInstalled__";

function installNavigationEvents() {
  if (window[HISTORY_PATCH_FLAG]) {
    return;
  }

  window[HISTORY_PATCH_FLAG] = true;

  const originalPushState = window.history.pushState.bind(window.history);
  const originalReplaceState = window.history.replaceState.bind(window.history);

  window.history.pushState = (...args) => {
    const result = originalPushState(...args);
    window.dispatchEvent(new Event("app:navigation"));
    return result;
  };

  window.history.replaceState = (...args) => {
    const result = originalReplaceState(...args);
    window.dispatchEvent(new Event("app:navigation"));
    return result;
  };
}

installNavigationEvents();

function normalizePathname(pathname) {
  const normalized = String(pathname || "/")
    .trim()
    .toLowerCase()
    .replace(/\/+$/, "");

  return normalized || "/";
}

function routeMatches(path, route) {
  return path === route || path.startsWith(`${route}/`);
}

function isHrmsRoute(pathname) {
  const path = normalizePathname(pathname);

  if (routeMatches(path, HRMS_PREFIX)) {
    return true;
  }

  if (HRMS_PUBLIC_ROUTES.some((route) => routeMatches(path, route))) {
    return true;
  }

  return HRMS_LEGACY_ROUTES.some((route) => routeMatches(path, route));
}

function isWebsiteRoute(pathname) {
  return !isHrmsRoute(pathname);
}

function useCurrentPathname() {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    const syncPathname = () => {
      setPathname(window.location.pathname);
    };

    window.addEventListener("popstate", syncPathname);
    window.addEventListener("app:navigation", syncPathname);

    return () => {
      window.removeEventListener("popstate", syncPathname);
      window.removeEventListener("app:navigation", syncPathname);
    };
  }, []);

  return pathname;
}

function applyApplicationMode(websiteMode) {
  const html = document.documentElement;
  const body = document.body;

  html.classList.toggle("yc-website-mode", websiteMode);
  body.classList.toggle("yc-website-mode", websiteMode);

  html.classList.toggle("yc-hrms-mode", !websiteMode);
  body.classList.toggle("yc-hrms-mode", !websiteMode);

  if (!websiteMode) {
    html.classList.remove(
      "yc-horizontal-mode",
      "yc-splash-open",
      "menu-open",
    );

    body.classList.remove(
      "yc-horizontal-mode",
      "yc-splash-open",
      "menu-open",
    );

    html.style.removeProperty("height");
    html.style.removeProperty("overflow");
    html.style.removeProperty("overflow-x");
    html.style.removeProperty("overflow-y");
    html.style.removeProperty("touch-action");

    body.style.removeProperty("height");
    body.style.removeProperty("overflow");
    body.style.removeProperty("overflow-x");
    body.style.removeProperty("overflow-y");
    body.style.removeProperty("touch-action");
    body.style.removeProperty("overscroll-behavior");
  }
}

function IntegratedApp() {
  const pathname = useCurrentPathname();
  const websiteMode = isWebsiteRoute(pathname);

  useEffect(() => {
    applyApplicationMode(websiteMode);

    return () => {
      document.documentElement.classList.remove(
        "yc-website-mode",
        "yc-hrms-mode",
      );

      document.body.classList.remove(
        "yc-website-mode",
        "yc-hrms-mode",
      );
    };
  }, [websiteMode]);

  if (websiteMode) {
    return (
      <BrowserRouter>
        <WebsiteApp />
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter>
      <App />
    </BrowserRouter>
  );
}

createRoot(rootElement).render(
  <React.StrictMode>
    <IntegratedApp />
  </React.StrictMode>,
);