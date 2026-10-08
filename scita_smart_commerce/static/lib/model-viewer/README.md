# model-viewer (vendored)

- Package: `@google/model-viewer` 4.3.1 from the official npm registry
  (https://registry.npmjs.org/@google/model-viewer/-/model-viewer-4.3.1.tgz,
  sha1 `2c9f2e9828544fe9fde59e05f1c1b42a59561cc9`, matches the registry `dist.shasum`).
- File: `dist/model-viewer.min.js` - self-contained ES module (three.js and lit bundled).
- License: Apache-2.0 (see `LICENSE`); bundled dependencies keep their own notices
  (lit: BSD-3-Clause, three.js: MIT) in the file's `@license` comments.
- Not part of any Odoo asset bundle: `scita_smart_commerce/static/src/hotspot_ar/ar_viewer.js`
  injects it with `<script type="module">` the first time a 3D/AR viewer is opened.
