# CSS ownership

- `index.css` — global stylesheet entry point.
- `base.css` — fonts, tokens, reset, buttons and shared utilities.
- `public-site.css` — shared public pages, cards, footer and common components.
- `public-layout.css` — page shell, horizontal homepage deck and responsive layout mechanics.
- `site-header.css` — navigation and header only. Imported by `SiteHeader.jsx`.
- `homepage-hero.css` — homepage hero only.
- `homepage-sections.css` — homepage Sections 02–07 only. Section 03 has no other CSS owner.
- `auth-pages.css` — login/authentication visuals only. Imported by `LoginPage.jsx`.

Do not add homepage section selectors to `homepage-hero.css` or global layout files.
