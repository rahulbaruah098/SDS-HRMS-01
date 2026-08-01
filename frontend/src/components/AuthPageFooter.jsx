export default function AuthPageFooter() {
  const currentYear = new Date().getFullYear();

  const openPrivacyManager = () => {
    window.dispatchEvent(
      new CustomEvent("yc-open-policy-consent"),
    );
  };

  const preparePublicPageNavigation = () => {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }

    window.scrollTo({
      top: 0,
      left: 0,
      behavior: "auto",
    });
  };

  return (
    <footer className="auth-page-footer">
      <div className="auth-page-footer-main">
        <span>
          © {currentYear} YourComate HRMS. All rights reserved.
        </span>

        <nav aria-label="Authentication page footer">
          <button type="button" onClick={openPrivacyManager}>
            Manage privacy
          </button>

          <a
            href="/cookies"
            onClick={preparePublicPageNavigation}
          >
            Cookie Policy
          </a>

          <span>People. Process. Performance.</span>
        </nav>
      </div>

      <div className="auth-page-footer-credit">
        <span>
          Built by{" "}
          <a
            href="https://sayanant.com"
            target="_blank"
            rel="noreferrer"
          >
            Sayanant
          </a>{" "}
          Group
        </span>
      </div>
    </footer>
  );
}
