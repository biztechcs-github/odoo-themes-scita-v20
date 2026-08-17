## Context

The repo already carries a large uncommitted WIP directly targeting this same goal: 51 files staged (+13,184/-12,922) plus 44 more files with unstaged edits on top, last real commit by a teammate (`amisha.darji`). It already implements several of the patterns this change would otherwise propose from scratch:

- Self-hosted Google Fonts (`migrations/19.0.0.17`) so Poppins never hits `fonts.gstatic.com`/`fonts.googleapis.com`.
- Preconnect cleanup, icon-font preload, and an LCP-image preload (`website._scita_lcp_preload_href`) with measured before/after data in code comments (e.g. FCP 2.76s → 3.60s when a preload was wrongly dropped).
- An async-CSS pattern (`theme_scita_async_snippet_css`) that loads `assets_snippet_product_css` via `media="print"` and promotes it to `all` on load — proven safe because it only styles content that arrives after page load (RPC-injected sliders, quick-view modal).
- `content_snippets.scss` and `product_snippets.scss` already split out of a larger bundle (staged as new files).
- A new `gzip_middleware.py` model, uncommitted.

None of this is reviewed or verified working yet. The Lighthouse report (Performance 73) may reflect this WIP already partially applied to the running instance, not a clean baseline — so the actual remaining gap to ~85 can't be determined until the WIP itself is confirmed correct.

See proposal.md for the overall motivation (CSS/font/image delivery, Lighthouse 73 → ~85).

## Goals / Non-Goals

**Goals:**
- Verify the existing uncommitted WIP is functionally correct and free of regressions before building anything further on top of it.
- Close the remaining gap to ~85 by extending the same patterns the WIP already established (self-hosted fonts, preload/preconnect hints, `media="print"` async CSS), not by introducing a competing approach.
- Preserve current behavior and CLS=0 throughout — no visual or functional regressions on any page type the WIP touches.

**Non-Goals:**
- Redesigning the WIP's approach or introducing a different lazy-loading/build mechanism.
- Any backend/business-logic change unrelated to asset delivery or performance.
- Deciding scope for `gzip_middleware.py` before its correctness and interaction with any existing reverse-proxy compression is understood (see Open Questions).

## Decisions

**1. Review before extend.** Audit the full staged+unstaged diff for correctness (broken view-inheritance xpaths, JS errors, missing static file references, snippet-builder drag/drop breakage) before adding any new optimization on top. Rationale: building further changes on an unverified 13k-line diff risks compounding bugs that are hard to attribute later; a working baseline must exist first. Alternative considered — treat the WIP as opaque and just measure/extend around it — rejected because the WIP directly touches the same CSS/font/asset surfaces this change needs to modify.

**2. Reuse the established async-CSS pattern for remaining unused CSS.** The audit's largest unused-CSS contributor is `content_snippets.scss`/`product_hover_effect.scss`, still shipped synchronously in `web.assets_frontend` per an explicit comment: their snippet bodies are rebuilt via `innerHTML` by the builder plugins, so a per-snippet `t-call-assets` doesn't survive drag-and-drop. The existing `media="print"` promotion trick is inserted at the `website.layout` `<head>` level (not per-snippet), so it survives that rebuild — the same mechanism used for `assets_snippet_product_css`. Extending it (for the portions of those two files that are not needed above-the-fold) is the natural continuation rather than a new mechanism. Alternative — critical-CSS extraction/inlining — rejected as a bigger architectural change than this WIP's established style, and higher risk of drift as snippets are added/edited.

**3. Treat image resizing and legacy-JS trimming as independent, low-risk follow-ups.** These don't intersect the WIP's touched files in ways that require the WIP to be verified first, so they can proceed in parallel with the review.

**4. Verification method.** Re-run Lighthouse against `localhost:8080` in an incognito window after each batch of changes (the original report flagged IndexedDB-cached data skewing scores), plus manual click-through of each major page type the WIP touches (homepage, category, product detail, checkout, a snippet-builder edit session) to confirm no regressions, per project convention on this task ("but not break the working flow").

## Risks / Trade-offs

- [Risk] The WIP touches nearly every view file; one broken xpath or missing asset reference could break page rendering site-wide → Mitigation: full diff review first, then targeted manual testing per page type before any further change is layered on.
- [Risk] `gzip_middleware.py` is new and uncommitted; if the deployment already gzips at a reverse-proxy layer (nginx/etc.), this could double-compress or emit conflicting headers → Mitigation: confirm the deployment's existing compression setup before deciding to keep, fix, or drop it.
- [Risk] Deferring more of `content_snippets.scss`/`product_hover_effect.scss` to async load could cause a flash-of-unstyled-content if any of it actually styles above-the-fold elements → Mitigation: visually verify which selectors are above-the-fold before moving anything into the async bundle; keep those synchronous.
- [Risk] Since some files were edited today, the module may not currently install/upgrade cleanly → Mitigation: confirm a clean `-u theme_scita` module upgrade with zero warnings before treating the WIP as a valid baseline to build on.

## Open Questions

- ~~Whether `gzip_middleware.py` stays in scope for this change or is better split into its own follow-up~~ — Resolved during implementation: removed. It monkeypatched `odoo.http.Application.__call__` process-wide (multi-tenant blast radius on a shared worker, no uninstall hook) and did synchronous buffer+gzip on every compressible response, not just cached assets. Gzip belongs at the reverse-proxy/CDN layer (e.g. nginx `gzip on`), which is what Odoo's own deployment documentation recommends — not app-level monkeypatching inside a theme module. See tasks.md 3.1.

## Security Considerations

This change has no auth, data-access, or API surface: it touches static asset delivery only (CSS bundling, font preload/self-hosting, image sizing, JS transpilation target) plus one server-side rendering hook (`_post_processing_att` in `ir_qweb.py`) that only ever adds `loading`/`fetchpriority` attributes to `<img>` tags already present in the rendered page — it reads no user input and writes nothing. No new routes, no new models with access rules, no new fields on any model, no new external data sources. The one route-decorator change found during review (`/service_worker` gaining `website=True`) was unrelated to this change's scope and has been reverted to its original `auth="public"` behavior (see tasks.md 3.1, finding #12).

The `_scita_lcp_preload_href` method reads `main_object.sudo().arch` — a `sudo()` call, but it only parses the view's own template markup (developer/editor-authored XML, not end-user input) for a same-origin image URL to preload; it does not execute or return arbitrary content, and any failure returns `False` (see its own docstring/try-except). No injection surface, no IDOR surface (no record ID from a request parameter flows into a query anywhere in this change).
