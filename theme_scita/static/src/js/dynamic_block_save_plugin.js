/** @odoo-module **/

import { Plugin } from "@html_editor/plugin";
import { registry } from "@web/core/registry";
import { selectElements } from "@html_editor/utils/dom_traversal";

/**
 * Saving pages with Scita blocks.
 *
 * Classes the live site puts on dynamic blocks while they load (compat/public_widget.js) or when
 * they got no data (dynamic_block_empty.js) must never be saved with the page: a block saved
 * with `o_scita_dyn_empty` would stay hidden for visitors once configured.
 */
const RUNTIME_CLASSES = ["o_scita_dyn_wait", "o_scita_dyn_empty"];

// The Category and dynamic Product blocks show a sample screenshot until their records load:
// replacing that image from the editor makes no sense, so it gets no Image options (Odoo skips
// o_snippet_not_selectable) and its container is not editable (no double-click media dialog).
const DYNAMIC_SAMPLE = [
    // Category snippets
    ".s_theme_scita_category_slider",
    ".scita_category_slider_3",
    ".scita_category_slider_4",
    ".oe_category_slider",
    // Multi Product snippets
    ".sct_product_snippet_1",
    ".sct_product_snippet_2",
    ".s_theme_scita_deal_of_the_day",
    ".fashion_multi_category_slider",
    ".theme_scita_trending_products",
    ".deal_multi_product_slider",
].map((block) => `${block} .category-slider-placeholder`).join(", ");
const DYNAMIC_SAMPLE_IMG = DYNAMIC_SAMPLE.split(", ").map((sel) => `${sel} img`).join(", ");

export class ScitaDynamicBlockSavePlugin extends Plugin {
    static id = "scitaDynamicBlockSave";

    resources = {
        // a link whose only content is a Lineicons icon (Scita's icon font: wishlist / compare
        // buttons of the static product blocks...) is not "empty": Odoo only knows its own icon
        // classes and removed such links (keeping the bare icon) whenever the page was saved
        is_empty_link_legit_predicates: (linkEl) =>
            linkEl.querySelector(".lni, [class*='lni-']") ? true : undefined,
        content_not_editable_selectors: DYNAMIC_SAMPLE,
        normalize_processors: (root) => {
            for (const img of selectElements(root, DYNAMIC_SAMPLE_IMG)) {
                img.classList.add("o_snippet_not_selectable");
            }
            return root;
        },
        clean_for_save_processors: (root) => {
            for (const el of selectElements(root, RUNTIME_CLASSES.map((c) => "." + c).join(","))) {
                el.classList.remove(...RUNTIME_CLASSES);
            }
            for (const img of selectElements(root, DYNAMIC_SAMPLE_IMG)) {
                img.classList.remove("o_snippet_not_selectable");
            }
            // a +New page's #wrap is itself the editable area, saved with its classes: the ones
            // added on display (ir_qweb.py, scita_fronted.js) stayed in the page for good
            for (const wrap of selectElements(root, "div#wrap")) {
                wrap.classList.remove("js_sale", "oe_website_sale");
            }
            return root;
        },
    };
}

registry.category("website-plugins").add(ScitaDynamicBlockSavePlugin.id, ScitaDynamicBlockSavePlugin);
