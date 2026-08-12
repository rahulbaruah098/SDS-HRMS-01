import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { navigationMenus } from "../data/publicSiteData";
import Brand from "./Brand";
import Icon from "./Icon";
import "../styles/site-header.css";

function getRoutePath(href) {
  return href.split("#")[0].split("?")[0];
}


function isVisibleResourceMenuLink([label, href]) {
  const normalizedLabel = String(label || "").trim().toLowerCase();
  const normalizedHref = String(href || "").trim().toLowerCase();

  return (
    normalizedLabel !== "hr templates" &&
    normalizedHref !== "/resources#templates" &&
    normalizedHref !== "/resources/evaluation-template"
  );
}

function getVisibleMenuGroups(menu) {
  return menu.groups
    .map((group) => ({
      ...group,
      links: group.links.filter(isVisibleResourceMenuLink),
    }))
    .filter((group) => group.links.length > 0);
}

function isMenuRouteActive(menu, pathname) {
  return [
    menu.featured.href,
    ...getVisibleMenuGroups(menu).flatMap((group) => group.links.map(([, href]) => href)),
  ]
    .map(getRoutePath)
    .some(
      (path) =>
        pathname === path ||
        (path !== "/" && pathname.startsWith(`${path}/`)),
    );
}

function getMenuTone(menu) {
  return getVisibleMenuGroups(menu)[0]?.tone || "violet";
}

export default function SiteHeader() {
  const location = useLocation();
  const navRef = useRef(null);
  const closeMenuTimerRef = useRef(null);
  const activeMenuRef = useRef(null);
  const mobileOpenRef = useRef(false);
  const mobileMenuCanvasRef = useRef(null);
  const mobilePanelRefs = useRef(new Map());
  const mobileGroupScrollFrameRef = useRef(null);
  const pendingMobileGroupScrollRef = useRef(null);

  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeMenu, setActiveMenu] = useState(null);
  const [mobileGroup, setMobileGroup] = useState(null);
  const [pageIndex, setPageIndex] = useState(0);

  useEffect(() => {
    activeMenuRef.current = activeMenu;
  }, [activeMenu]);

  useEffect(() => {
    mobileOpenRef.current = mobileOpen;
  }, [mobileOpen]);

  const cancelMenuClose = useCallback(() => {
    if (!closeMenuTimerRef.current) return;
    window.clearTimeout(closeMenuTimerRef.current);
    closeMenuTimerRef.current = null;
  }, []);

  const openDesktopMenu = useCallback(
    (menuKey) => {
      cancelMenuClose();
      setActiveMenu(menuKey);
    },
    [cancelMenuClose],
  );

  const scheduleMenuClose = useCallback(() => {
    cancelMenuClose();
    closeMenuTimerRef.current = window.setTimeout(() => {
      setActiveMenu(null);
      closeMenuTimerRef.current = null;
    }, 90);
  }, [cancelMenuClose]);

  const cancelMobileGroupScroll = useCallback(() => {
    if (mobileGroupScrollFrameRef.current === null) return;

    window.cancelAnimationFrame(mobileGroupScrollFrameRef.current);
    mobileGroupScrollFrameRef.current = null;
  }, []);

  const registerMobilePanel = useCallback((menuKey, node) => {
    if (node) {
      mobilePanelRefs.current.set(menuKey, node);
      return;
    }

    mobilePanelRefs.current.delete(menuKey);
  }, []);

  const closeMobileMenu = useCallback(() => {
    cancelMobileGroupScroll();
    pendingMobileGroupScrollRef.current = null;
    setMobileOpen(false);
    setMobileGroup(null);
  }, [cancelMobileGroupScroll]);

  const toggleMobileMenu = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    setMobileOpen((current) => !current);
  }, []);

  const toggleMobileGroup = useCallback((event, menuKey) => {
    event.preventDefault();
    event.stopPropagation();

    setMobileGroup((current) => {
      const nextGroup = current === menuKey ? null : menuKey;

      pendingMobileGroupScrollRef.current = nextGroup;

      return nextGroup;
    });
  }, []);

  /*
   * Once React has collapsed the previous group and rendered the newly opened
   * group, align that section with the top of the menu's own scroll area.
   */
  useLayoutEffect(() => {
    if (
      !mobileOpen ||
      !mobileGroup ||
      pendingMobileGroupScrollRef.current !== mobileGroup
    ) {
      return undefined;
    }

    cancelMobileGroupScroll();

    mobileGroupScrollFrameRef.current = window.requestAnimationFrame(() => {
      const canvas = mobileMenuCanvasRef.current;
      const panel = mobilePanelRefs.current.get(mobileGroup);

      if (!canvas || !panel) {
        pendingMobileGroupScrollRef.current = null;
        mobileGroupScrollFrameRef.current = null;
        return;
      }

      const canvasRect = canvas.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const targetTop =
        canvas.scrollTop + panelRect.top - canvasRect.top;

      canvas.scrollTo({
        top: Math.max(0, targetTop),
        behavior: "smooth",
      });

      pendingMobileGroupScrollRef.current = null;
      mobileGroupScrollFrameRef.current = null;
    });

    return cancelMobileGroupScroll;
  }, [
    cancelMobileGroupScroll,
    mobileGroup,
    mobileOpen,
  ]);

  useEffect(() => {
    const handleDeckState = (event) => {
      setPageIndex(Number(event.detail?.index || 0));
    };

    window.addEventListener("yc-page-deck-state", handleDeckState);
    return () => window.removeEventListener("yc-page-deck-state", handleDeckState);
  }, []);

  useEffect(() => {
    cancelMenuClose();
    setMobileOpen(false);
    setActiveMenu(null);
    setMobileGroup(null);
    setPageIndex(0);
  }, [cancelMenuClose, location.pathname, location.search]);

  /*
   * Register global listeners once. Menu state is read from refs, so opening
   * the mobile navigation does not tear down and recreate page-level handlers.
   */
  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key !== "Escape") return;

      if (mobileOpenRef.current) {
        closeMobileMenu();
      }

      if (activeMenuRef.current) {
        setActiveMenu(null);
      }
    };

    const handleOutside = (event) => {
      if (!activeMenuRef.current || navRef.current?.contains(event.target)) {
        return;
      }

      setActiveMenu(null);
    };

    window.addEventListener("keydown", handleEscape);
    document.addEventListener("pointerdown", handleOutside);

    return () => {
      cancelMenuClose();
      cancelMobileGroupScroll();
      window.removeEventListener("keydown", handleEscape);
      document.removeEventListener("pointerdown", handleOutside);
    };
  }, [
    cancelMenuClose,
    cancelMobileGroupScroll,
    closeMobileMenu,
  ]);

  /* Lock only document scrolling. The menu remains independently scrollable. */
  useLayoutEffect(() => {
    document.documentElement.classList.toggle("menu-open", mobileOpen);
    document.body.classList.toggle("menu-open", mobileOpen);

    return () => {
      document.documentElement.classList.remove("menu-open");
      document.body.classList.remove("menu-open");
    };
  }, [mobileOpen]);

  return (
    <>
      <header
        className={`public-site-header ${pageIndex > 0 ? "is-progressed" : ""} ${mobileOpen ? "is-menu-open" : ""}`}
      >
        <div className="yc-saya-promo">
          <Link to="/saya">
            <span>
              <Icon name="sparkle" /> Saya AI is built into YourComate
            </span>
            <strong>
              Meet your role-aware HR assistant <Icon name="arrow" />
            </strong>
          </Link>
        </div>

        <div className="yc-header-progress" aria-hidden="true">
          <i />
        </div>

        <div className="public-navbar">
          <Brand compact />

          <nav
            className="public-desktop-nav"
            aria-label="Primary navigation"
            ref={navRef}
          >
            {navigationMenus.map((menu) => {
              const isOpen = activeMenu === menu.key;
              const isCurrent = isMenuRouteActive(menu, location.pathname);
              const menuId = `desktop-${menu.key}-menu`;

              return (
                <div
                  className="public-nav-item"
                  key={menu.key}
                  onPointerEnter={() => openDesktopMenu(menu.key)}
                  onPointerLeave={scheduleMenuClose}
                  onFocus={() => openDesktopMenu(menu.key)}
                  onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) {
                      scheduleMenuClose();
                    }
                  }}
                >
                  <div
                    className={`public-nav-trigger ${isOpen || isCurrent ? "is-active" : ""}`}
                  >
                    <NavLink to={menu.featured.href}>{menu.label}</NavLink>

                    <button
                      type="button"
                      className="public-nav-submenu-toggle"
                      aria-label={`${isOpen ? "Close" : "Open"} ${menu.label} menu`}
                      aria-expanded={isOpen}
                      aria-controls={menuId}
                      onClick={() =>
                        setActiveMenu((current) =>
                          current === menu.key ? null : menu.key,
                        )
                      }
                    >
                      <Icon name="chevronDown" />
                    </button>
                  </div>

                  <div
                    id={menuId}
                    className={`public-mega-menu ${isOpen ? "is-open" : ""}`}
                    onPointerEnter={() => openDesktopMenu(menu.key)}
                    onPointerLeave={scheduleMenuClose}
                  >
                    <Link
                      className="public-mega-feature"
                      to={menu.featured.href}
                    >
                      <small>{menu.featured.eyebrow}</small>
                      <h3>{menu.featured.title}</h3>
                      <p>{menu.featured.copy}</p>
                      <span>
                        {menu.featured.linkLabel}
                        <Icon name="arrow" />
                      </span>
                    </Link>

                    <div className="public-mega-groups">
                      {getVisibleMenuGroups(menu).map((group, groupIndex) => (
                        <section
                          className={`public-mega-group tone-${group.tone}`}
                          key={group.title}
                        >
                          <header>
                            <b>{String(groupIndex + 1).padStart(2, "0")}</b>
                            <h4>{group.title}</h4>
                          </header>

                          <div>
                            {group.links.map(([label, href, icon]) => (
                              <Link to={href} key={href}>
                                <span>
                                  <Icon name={icon} />
                                </span>
                                <b>{label}</b>
                                <Icon name="arrow" />
                              </Link>
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}

            <NavLink to="/pricing">Pricing</NavLink>
            <NavLink to="/customers">Customers</NavLink>
            <NavLink to="/contact">Contact Us</NavLink>
          </nav>

          <div className="public-navbar-actions">
          <a className="public-login-link" href="/login">
  LOGIN
</a>

           <a
  className="button button-primary button-small public-demo-button"
  href="/apply-demo-registration"
>
  Start a demo <Icon name="arrow" />
</a>

            <button
              className={`public-menu-toggle ${mobileOpen ? "is-open" : ""}`}
              type="button"
              aria-label={
                mobileOpen ? "Close navigation menu" : "Open navigation menu"
              }
              aria-expanded={mobileOpen}
              aria-controls="public-mobile-navigation"
              onClick={toggleMobileMenu}
            >
              <span className="public-menu-toggle-mark" aria-hidden="true">
                <svg
                  className="public-menu-toggle-closed"
                  viewBox="0 0 48 34"
                  fill="none"
                >
                  <path d="M7 8h24c5 0 8 2.2 8 5.7s-3 5.8-8 5.8H17c-5 0-8 2.2-8 5.7S12 31 17 31h24" />
                  <circle cx="8" cy="8" r="2.3" />
                  <circle cx="40" cy="31" r="2.3" />
                </svg>

                <svg
                  className="public-menu-toggle-open"
                  viewBox="0 0 48 34"
                  fill="none"
                >
                  <path d="M11 7.5 37 26.5" />
<path d="M37 7.5 11 26.5" />
                </svg>
              </span>
            </button>
          </div>
        </div>
      </header>

      <button
        className={`public-menu-backdrop ${mobileOpen ? "is-open" : ""}`}
        type="button"
        aria-label="Close navigation menu"
        onClick={closeMobileMenu}
      />

      <aside
        id="public-mobile-navigation"
        className={`public-mobile-menu ${mobileOpen ? "is-open" : ""}`}
        aria-hidden={!mobileOpen}
        aria-label="Mobile navigation"
      >
        <div className="yc-mobile-menu-intro">
          <div>
            <small>YOURCOMATE DIRECTORY</small>
            <h2>Choose where work begins.</h2>
          </div>
          <span>{String(navigationMenus.length + 5).padStart(2, "0")} routes</span>
        </div>

        <nav
          ref={mobileMenuCanvasRef}
          className="yc-mobile-menu-canvas"
          aria-label="Mobile navigation links"
        >
          <NavLink
            className="yc-mobile-home-route"
            to="/"
            onClick={closeMobileMenu}
          >
            <b>00</b>
            <span>
              <small>Start here</small>
              <strong>Homepage</strong>
            </span>
            <Icon name="arrow" />
          </NavLink>

          {navigationMenus.map((menu, menuIndex) => {
            const isOpen = mobileGroup === menu.key;
            const groupId = `mobile-${menu.key}-menu`;
            const tone = getMenuTone(menu);

            return (
              <section
                ref={(node) => registerMobilePanel(menu.key, node)}
                className={`yc-mobile-menu-panel tone-${tone} ${isOpen ? "is-open" : ""}`}
                key={menu.key}
              >
                <button
                  type="button"
                  className="yc-mobile-menu-panel-toggle"
                  aria-expanded={isOpen}
                  aria-controls={groupId}
                  onClick={(event) =>
                    toggleMobileGroup(event, menu.key)
                  }
                >
                  <b>{String(menuIndex + 1).padStart(2, "0")}</b>

                  <span>
                    <small>{menu.featured.eyebrow}</small>
                    <strong>{menu.label}</strong>
                  </span>

                  <i aria-hidden="true">
                    <em />
                    <em />
                  </i>
                </button>

                {isOpen && (
                  <div
                    id={groupId}
                    className="yc-mobile-menu-panel-content"
                    role="region"
                    aria-label={`${menu.label} links`}
                  >
                    <Link
                      className="yc-mobile-menu-feature"
                      to={menu.featured.href}
                      onClick={closeMobileMenu}
                    >
                      <small>{menu.featured.title}</small>
                      <p>{menu.featured.copy}</p>
                      <span>
                        {menu.featured.linkLabel} <Icon name="arrow" />
                      </span>
                    </Link>

                    <div className="yc-mobile-menu-link-grid">
                      {getVisibleMenuGroups(menu)
                        .flatMap((group) => group.links)
                        .map(([label, href, icon]) => (
                          <Link
                            to={href}
                            key={`${menu.key}-${href}`}
                            onClick={closeMobileMenu}
                          >
                            <span>
                              <Icon name={icon} />
                            </span>
                            <b>{label}</b>
                            <Icon name="arrow" />
                          </Link>
                        ))}
                    </div>
                  </div>
                )}
              </section>
            );
          })}

          <div className="yc-mobile-quick-routes">
            {[
              ["04", "Pricing", "/pricing", "briefcase"],
              ["05", "Customers", "/customers", "people"],
              ["06", "Contact Us", "/contact", "email"],
              ["07", "Saya AI", "/saya", "sparkle"],
            ].map(([number, label, href, icon]) => (
              <NavLink to={href} key={href} onClick={closeMobileMenu}>
                <b>{number}</b>
                <span>
                  <Icon name={icon} />
                  {label}
                </span>
              </NavLink>
            ))}
          </div>
        </nav>

        <div className="public-mobile-menu-actions">
        <a
  className="button button-ghost"
  href="/login"
  onClick={closeMobileMenu}
>
  LOGIN
</a>

       <a
  className="button button-primary"
  href="/apply-demo-registration"
  onClick={closeMobileMenu}
>
  Start a demo
</a>
        </div>
      </aside>
    </>
  );
}
