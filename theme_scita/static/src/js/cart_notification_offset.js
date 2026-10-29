/** @odoo-module **/

import { onMounted, onWillUnmount } from "@odoo/owl";
import { patch } from "@web/core/utils/patch";
import { CartNotificationContainer } from "@website_sale/js/cart_notification/cart_notification_container/cart_notification_container";

// The "added to cart" popup is placed just below the header: Odoo adds up the visible part of
// every `.o_top_fixed_element` (height + top). It expects that header to stay on screen, but
// a header without a scroll effect scrolls away with the page. So
// - after scrolling down, `top` was very negative and the popup opened above the screen;
// - Odoo only recomputes on window / header changes, not on scrolling, so after scrolling
//   back up the popup kept its old place, half behind the header icons.
// Count only what is visible of each element, and follow the page scrolling.
patch(CartNotificationContainer.prototype, {
    setup() {
        super.setup(...arguments);
        let frame = null;
        const onScroll = () => {
            if (frame === null) {
                frame = requestAnimationFrame(() => {
                    frame = null;
                    this._scitaMeasureHeader();
                });
            }
        };
        onMounted(() => window.addEventListener("scroll", onScroll, { passive: true }));
        onWillUnmount(() => {
            window.removeEventListener("scroll", onScroll);
            if (frame !== null) {
                cancelAnimationFrame(frame);
            }
            cancelAnimationFrame(this._scitaAdaptFrame);
        });
    },

    // measured in the next frame: Odoo calls this when the page starts, and measuring right
    // then made the browser lay the page out an extra time
    _adaptToHeaderChange() {
        if (this._scitaAdaptFrame) {
            return;
        }
        this._scitaAdaptFrame = requestAnimationFrame(() => {
            this._scitaAdaptFrame = null;
            this._scitaMeasureHeader();
        });
    },

    _scitaMeasureHeader() {
        let position = 0;
        for (const el of document.querySelectorAll(".o_top_fixed_element")) {
            const { height, top } = el.getBoundingClientRect();
            // the element's visible height; nothing once it has scrolled out of view
            position += Math.max(0, height + top);
        }
        if (this.state.topOffset !== position) {
            this.state.topOffset = position;
        }
    },
});
