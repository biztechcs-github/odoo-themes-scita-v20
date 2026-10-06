/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { ComparisonPage } from "@website_sale/interactions/comparison_page";

// The compare page's sticky mini overview, as Odoo 20 builds it, relies on two things that
// Scita changes:
// 1. it measures the product image row (`#o_comparelist_table ul:first-of-type`); on phones
//    Scita lays the table out as 2 + 2 products (product_card_equal_height.scss), where that
//    row is `display: contents` and has no box - it measured 0 high, so the overview showed
//    from the start, over the page title and images. Measure its first cell instead.
// 2. it listens to `window` scroll, but Scita makes #wrapwrap the scrolling element
//    (comman.scss), so the overview never appeared. Also listen to the element that scrolls.
patch(ComparisonPage.prototype, {
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
        const scrollHandlers = [];
        const addEventListener = window.addEventListener;
        window.addEventListener = function (type, handler, options) {
            if (type === "scroll") {
                scrollHandlers.push(handler);
            }
            return addEventListener.call(this, type, handler, options);
        };
        try {
            return super._initMiniStickyComparison(...arguments);
        } finally {
            el.querySelector = querySelector;
            window.addEventListener = addEventListener;
            const scrollingEl = el.ownerDocument.querySelector("#wrapwrap");
            if (scrollingEl && getComputedStyle(scrollingEl).overflowY !== "visible") {
                for (const handler of scrollHandlers) {
                    scrollingEl.addEventListener("scroll", handler, { passive: true });
                    this.registerCleanup(() =>
                        scrollingEl.removeEventListener("scroll", handler, { passive: true })
                    );
                }
            }
        }
    },
});
