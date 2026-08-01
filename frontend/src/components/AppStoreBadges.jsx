export function PlayStoreIcon() {
  return (
    <svg viewBox="0 0 64 72" aria-hidden="true">
      <path fill="#34A853" d="M4 5.5 37.5 36 4 66.5c-2-1.8-3-4.3-3-7.4V12.9c0-3.1 1-5.6 3-7.4Z" />
      <path fill="#4285F4" d="m37.5 36 9.6-8.7L13.9 8.2C10.5 6.2 7.3 4.9 4 5.5L37.5 36Z" />
      <path fill="#FBBC04" d="m37.5 36-33.5 30.5c3.3.6 6.5-.7 9.9-2.7l33.2-19.1-9.6-8.7Z" />
      <path fill="#EA4335" d="M58 33.5 47.1 27.3 37.5 36l9.6 8.7L58 38.5c3.3-1.9 3.3-3.1 0-5Z" />
    </svg>
  );
}

export function AppleIcon() {
  return (
    <svg viewBox="0 0 64 76" aria-hidden="true">
      <path fill="currentColor" d="M47.7 40.3c.1-10.2 8.4-15.2 8.8-15.4-4.7-6.9-12.1-7.9-14.7-8-6.3-.6-12.2 3.7-15.4 3.7-3.2 0-8.1-3.6-13.3-3.5C6.3 17.2 0 21.1-3.5 27.2c-7.3 12.7-1.9 31.5 5.2 41.8 3.5 5 7.6 10.5 13 10.3 5.2-.2 7.2-3.3 13.5-3.3 6.3 0 8.1 3.3 13.6 3.2 5.6-.1 9.2-5.1 12.6-10.1 4-5.8 5.6-11.4 5.7-11.7-.1 0-10.8-4.1-10.9-17.1h-1.5ZM37.7 10.4C40.5 7 42.4 2.3 41.9-2.4c-4.1.2-9.1 2.7-12 6.1-2.6 3-4.9 7.8-4.3 12.4 4.6.4 9.3-2.3 12.1-5.7Z" transform="translate(4 2) scale(.86)" />
    </svg>
  );
}

export default function AppStoreBadges({
  compact = false,
  className = "",
  disabled = false,
}) {
  const wrapperClassName = `yc-store-badges${compact ? " is-compact" : ""}${className ? ` ${className}` : ""}`;
  const playBadgeContent = (
    <>
      <PlayStoreIcon />
      <span>
        <small>GET IT ON</small>
        <strong>Google Play</strong>
      </span>
    </>
  );

  return (
    <div className={wrapperClassName}>
      {disabled ? (
        <span
          className="yc-store-badge yc-store-badge-play"
          aria-label="YourComate for Android is coming soon"
          aria-disabled="true"
        >
          {playBadgeContent}
        </span>
      ) : (
        <a
          className="yc-store-badge yc-store-badge-play"
          href="#yourcomate-app"
          aria-label="Get YourComate on Google Play"
        >
          {playBadgeContent}
        </a>
      )}

      <span
        className="yc-store-badge yc-store-badge-apple is-coming"
        aria-label="YourComate for iOS is coming soon"
        aria-disabled="true"
      >
        <AppleIcon />
        <span>
          <small>COMING SOON ON</small>
          <strong>App Store</strong>
        </span>
      </span>
    </div>
  );
}
