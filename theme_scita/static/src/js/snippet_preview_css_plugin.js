/** @odoo-module **/

import { Plugin } from "@html_editor/plugin";
import { registry } from "@web/core/registry";

/**
 * The "Insert a block" dialog previews snippets in an iframe that only gets
 * web.assets_frontend. Most of Scita's block styles live in the separate (deferred)
 * theme_scita.assets_snippet_product_css bundle, so their previews were unstyled.
 */
class ScitaSnippetPreviewCssPlugin extends Plugin {
    static id = "scitaSnippetPreviewCss";

    resources = {
        snippet_preview_dialog_bundles: [
            "theme_scita.assets_snippet_product_css",
            "theme_scita.assets_shop_css",
            "theme_scita.assets_snippet_extra_css",
        ],
    };
}

registry
    .category("website-plugins")
    .add(ScitaSnippetPreviewCssPlugin.id, ScitaSnippetPreviewCssPlugin);
