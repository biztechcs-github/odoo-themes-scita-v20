/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { ComparisonPage } from "@website_sale/interactions/comparison_page";

// The compare page's sticky mini overview, as Odoo 20 builds it, relies on two things that
// Scita changes:
// 1. it measures the product image row (`#o_comparelist_table ul:first-of-type`); on phones
//    Scita lays the table out as 2 + 2 products (product_card_equal_height.scss), where that
//    row is `display: contents` and has no box - it measured 0 high, so the overview showed
//    from the start, over the page title and images. Measure its first cell instead.
// 2. it places the overview under the full height of the header (`.o_top_fixed_element`),
//    as if the header stayed on screen; a header without a scroll effect scrolls away, which
//    left a header-high blank strip above the overview. Count only what is visible of it,
//    again on every scroll (same as cart_notification_offset.js).
patch(ComparisonPage.prototype, {
    _adaptToHeaderChange() {
        let position = 0;
        for (const el of this.el.ownerDocument.querySelectorAll(".o_top_fixed_element")) {
            const { top, height } = el.getBoundingClientRect();
            position += Math.max(0, Math.min(height, height + top));
        }
        position = Math.round(position);
        if (this.position !== position) {
            this.position = position;
            this.updateContent();
            const miniStickyEl = this.el.querySelector("#miniStickyComparison");
            if (miniStickyEl) {
                miniStickyEl.style.top = `${position}px`;
            }
        }
    },

    _initMiniStickyComparison() {
        const el = this.el;
        const querySelector = el.querySelector;
        el.querySelector = function (selector) {
            const found = querySelector.call(this, selector);
            if (selector !== "#o_comparelist_table ul:first-of-type" || !found) {
                return found;
            }
            // Odoo only reads its box; pick the element to measure on each scroll so that
            // rotating the phone / resizing the window keeps working
            return {
                getBoundingClientRect() {
                    const measured =
                        getComputedStyle(found).display === "contents"
                            ? found.firstElementChild || found
                            : found;
                    return measured.getBoundingClientRect();
                },
            };
        };
        // first follow the header (it scrolls away), then Odoo shows/hides the overview
        const adaptToHeader = () => this._adaptToHeaderChange();
        window.addEventListener("scroll", adaptToHeader, { passive: true });
        this.registerCleanup(() => window.removeEventListener("scroll", adaptToHeader, { passive: true }));
        try {
            return super._initMiniStickyComparison(...arguments);
        } finally {
            el.querySelector = querySelector;
        }
    },
});
