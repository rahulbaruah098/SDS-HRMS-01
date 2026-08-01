import { Link } from "react-router-dom";

export default function Brand({ compact = false, inverse = false }) {
  const priority = compact;

  return (
    <Link
      className={`brand ${compact ? "brand-compact" : ""} ${
        inverse ? "brand-inverse" : ""
      }`}
      to="/"
      aria-label="YourComate HRMS homepage"
    >
      <img
        className="brand-logo-image"
        src="/images/yc-logo-160.webp"
        srcSet="/images/yc-logo-96.webp 96w, /images/yc-logo-160.webp 160w, /images/yc-logo-256.webp 256w"
        sizes={compact ? "(max-width: 980px) 59px, 76px" : "72px"}
        width="1952"
        height="1202"
        alt="YourComate"
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        fetchPriority={priority ? "high" : "auto"}
      />

      <small className="brand-tagline">
        People. Process. Performance.
      </small>
    </Link>
  );
}
