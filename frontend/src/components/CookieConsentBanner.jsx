import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

const STORAGE_KEY = "yourcomate_cookie_preference";

export default function CookieConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      setVisible(!window.localStorage.getItem(STORAGE_KEY));
    } catch {
      setVisible(true);
    }
  }, []);

  const save = (preference) => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ preference, savedAt: new Date().toISOString() }),
      );
    } catch {
      // The banner can still close when browser storage is unavailable.
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <aside className="cookie-consent-card" role="dialog" aria-label="Cookie preferences">
      <div className="cookie-consent-copy">
        <small>Your privacy choices</small>
        <strong>We use essential cookies to keep YourComate working correctly.</strong>
        <p>Optional preferences help us remember your website choices. No advertising cookies are enabled by this interface.</p>
        <Link to="/cookies">Read the Cookie Policy</Link>
      </div>
      <div className="cookie-consent-actions">
        <button className="button button-ghost" type="button" onClick={() => save("essential")}>Essential only</button>
        <button className="button button-primary" type="button" onClick={() => save("accepted")}>Accept cookies</button>
      </div>
    </aside>
  );
}
