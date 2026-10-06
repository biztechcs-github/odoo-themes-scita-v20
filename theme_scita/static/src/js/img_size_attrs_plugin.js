/** @odoo-module **/

import { Plugin } from "@html_editor/plugin";
import { registry } from "@web/core/registry";

const PX = /^\d+(\.\d+)?px$/;

/**
 * Odoo 20's editor turns the `width` / `height` attributes of every image of the edited
 * page into inline `width: Npx; height: Npx` styles when it starts (html_editor's
 * initElementForEdition, "the attributes will be re-applied on save"), and saves them as
 * such. Scita's blocks carry those attributes only as intrinsic-size hints (no layout shift
 * while images load): their CSS sizes the images (100% of a column, object-fit...). As
 * inline styles they override that CSS, e.g. the 500px placeholders of "How it Works 3"
 * then cover the text column next to them, and a 5000px "About Us" image breaks its block.
 *
 * Put such pixel pairs back as attributes when the page is saved.
 */
export class ScitaImageSizeAttributesPlugin extends Plugin {
    static id = "scitaImageSizeAttributes";

    resources = {
        clean_for_save_processors: (root) => {
            for (const img of root.querySelectorAll("img[style]")) {
                const { width, height } = img.style;
                if (
                    !PX.test(width) ||
                    !PX.test(height) ||
                    img.hasAttribute("width") ||
                    img.hasAttribute("height")
                ) {
                    continue;
                }
                img.setAttribute("width", Math.round(parseFloat(width)));
                img.setAttribute("height", Math.round(parseFloat(height)));
                img.style.removeProperty("width");
                img.style.removeProperty("height");
                if (!img.getAttribute("style").trim()) {
                    img.removeAttribute("style");
                }
            }
            return root;
        },
    };
}

registry
    .category("website-plugins")
    .add(ScitaImageSizeAttributesPlugin.id, ScitaImageSizeAttributesPlugin);
