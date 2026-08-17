## Why

A Lighthouse audit of the theme_scita storefront (localhost:8080) scores Performance at 73/100 against a target of ~85. The report attributes this mainly to a bloated, render-blocking CSS bundle (208.5 KiB, ~94% unused), a render-blocking Google Poppins font with no `font-display`/preconnect, and oversized non-responsive images — all fixable without touching page behavior or layout (CLS is already 0 and must stay that way).

## What Changes

- Reduce/split `web.assets_frontend.min.css` so the initial render only loads CSS actually used above the fold; keep the rest deferred or scoped, cutting the ~195 KiB of unused CSS flagged by the audit.
- Add `font-display: swap` (or `optional`) to font-face declarations and add `preconnect`/`preload` hints for the Google Poppins font and other 1st-party font requests to shorten the critical path.
- Resize/compress oversized images so delivered dimensions match displayed dimensions (responsive images), targeting the ~98 KiB of avoidable image transfer identified in the audit.
- Ensure `width`/`height` (or aspect-ratio) attributes are set on image elements to guard against introducing layout shift while touching image markup.
- Review JS build/transpilation output for legacy-only polyfills (`Array.prototype.at`, `Object.hasOwn`) that are unnecessary for the supported browser baseline, to trim wasted JS bytes and script parse time.
- Verify minification is applied to the CSS bundle (currently ~14 KiB of avoidable savings from minification alone).

No new pages, features, or user-facing behavior are introduced. No existing product capability's requirements change — this is a delivery/performance optimization of existing frontend assets. Every change must be verified to leave current page functionality, navigation, and visual layout intact.

## Capabilities

This change is a non-functional performance optimization with no new or modified product capabilities (`skip_specs: true` set in `.openspec.yaml`). No `specs/` deltas are produced; behavior is unchanged, only asset delivery.

## Impact

- **Affected code**: `theme_scita/static/` (CSS/SCSS sources, font declarations, image assets), and any asset bundle definitions in `__manifest__.py` (`web.assets_frontend`, etc.) or views that reference fonts/images.
- **Affected systems**: Odoo asset bundling (`web.assets_frontend.min.css`, `web.assets_frontend_lazy.min.js`, `web.assets_frontend_minimal.min.js`), the theme's font loading, and any templates rendering the homepage carousel/product images captured in the audit.
- **Dependencies**: None new. No backend/model changes expected — this is scoped to static assets and view-level asset references.
- **Verification**: Re-run Lighthouse against the same page (localhost:8080, incognito, to avoid the IndexedDB caching skew noted in the original report) after each batch of changes, and manually click through the affected pages to confirm no visual regressions or broken flows.
