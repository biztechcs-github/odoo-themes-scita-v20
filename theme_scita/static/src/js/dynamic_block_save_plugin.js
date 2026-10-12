/** @odoo-module **/

import { Plugin } from "@html_editor/plugin";
import { registry } from "@web/core/registry";

/**
 * Saving pages with Scita blocks.
 *
 * Classes the live site puts on dynamic blocks while they load (compat/public_widget.js) or when
 * they got no data (dynamic_block_empty.js) must never be saved with the page: a block saved
 * with `o_scita_dyn_empty` would stay hidden for visitors once configured.
 */
const RUNTIME_CLASSES = ["o_scita_dyn_wait", "o_scita_dyn_empty"];

export class ScitaDynamicBlockSavePlugin extends Plugin {
    static id = "scitaDynamicBlockSave";

    resources = {
        // a link whose only content is a Lineicons icon (Scita's icon font: wishlist / compare
        // buttons of the static product blocks...) is not "empty": Odoo only knows its own icon
        // classes and removed such links (keeping the bare icon) whenever the page was saved
        is_empty_link_legit_predicates: (linkEl) =>
            linkEl.querySelector(".lni, [class*='lni-']") ? true : undefined,
        clean_for_save_processors: (root) => {
            for (const el of root.querySelectorAll(RUNTIME_CLASSES.map((c) => "." + c).join(","))) {
                el.classList.remove(...RUNTIME_CLASSES);
            }
            return root;
        },
    };
}

registry.category("website-plugins").add(ScitaDynamicBlockSavePlugin.id, ScitaDynamicBlockSavePlugin);
