import { Interaction } from "@web/public/interaction";
import { registry } from "@web/core/registry";
import { rpc } from "@web/core/network/rpc";

const BAR_SELECTOR = ".o_scita_free_shipping_bar";
// Elements whose changes mean "the cart changed": the header badges (updated by the cart
// service and the cart page), the cart page lines and Scita's cart sidebar (reloaded on open).
const CART_CHANGE_SELECTOR = ".my_cart_quantity, .js_cart_lines, .cart_details";

/**
 * Free-delivery progress bar on the cart page and in Scita's cart sidebar (mini-cart).
 */
export class ScitaFreeShippingBar extends Interaction {
    static selector = "#wrapwrap[data-scita-fsb]";
    dynamicContent = {
        _root: { "t-on-click": this.onClick },
    };

    setup() {
        this.refresh = this.debounced(this.refresh, 300);
    }

    start() {
        this.injectMiniCartBar();
        if (document.querySelector(BAR_SELECTOR)) {
            // this script loads after the page: a cart change made before it started (fast
            // click) was not observed, so bring the bars up to date once
            this.refresh();
        }
        this.observer = new MutationObserver((mutations) => this.onMutations(mutations));
        this.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        this.registerCleanup(() => this.observer.disconnect());
    }

    /**
     * Scita's cart sidebar is a theme template (no xml id to inherit), so its bar
     * placeholder is added here, just above the totals.
     */
    injectMiniCartBar() {
        let added = false;
        for (const cartEl of document.querySelectorAll(".cart_details .cart-list-wrap")) {
            if (cartEl.querySelector(BAR_SELECTOR)) {
                continue;
            }
            const barEl = document.createElement("div");
            barEl.className = "o_scita_free_shipping_bar px-3 pt-3";
            barEl.dataset.context = "mini";
            const footerEl = cartEl.querySelector(".cart-footer");
            cartEl.insertBefore(barEl, footerEl);
            added = true;
        }
        return added;
    }

    onMutations(mutations) {
        let cartChanged = false;
        for (const mutation of mutations) {
            const target = mutation.target.nodeType === Node.ELEMENT_NODE
                ? mutation.target
                : mutation.target.parentElement;
            if (!target || target.closest(BAR_SELECTOR)) {
                continue; // our own re-render
            }
            const nodes = [target, ...mutation.addedNodes, ...mutation.removedNodes];
            if (nodes.some((node) => node.nodeType === Node.ELEMENT_NODE
                && (node.matches(CART_CHANGE_SELECTOR) || node.closest(CART_CHANGE_SELECTOR)
                    || node.querySelector?.(CART_CHANGE_SELECTOR)))) {
                cartChanged = true;
                break;
            }
        }
        if (cartChanged) {
            this.injectMiniCartBar();
            this.refresh();
        }
    }

    async refresh() {
        const barEls = [...document.querySelectorAll(BAR_SELECTOR)];
        if (!barEls.length) {
            return;
        }
        const contexts = [...new Set(barEls.map((el) => el.dataset.context || "cart"))];
        const results = {};
        for (const context of contexts) {
            try {
                results[context] = await this.waitFor(rpc("/scita/free_shipping/bar", { context }));
            } catch {
                // network error or session expired: keep the bar as it is, the next cart change retries
                return;
            }
        }
        for (const barEl of barEls) {
            if (!barEl.isConnected) {
                continue; // the sidebar was re-rendered meanwhile
            }
            const result = results[barEl.dataset.context || "cart"];
            // server-rendered QWeb (escaped), same approach as the core cart lines refresh
            barEl.innerHTML = result.show ? result.html : "";
        }
    }

    async onClick(ev) {
        const addEl = ev.target.closest(".o_scita_fsb_add");
        if (!addEl) {
            return;
        }
        ev.preventDefault();
        addEl.disabled = true;
        try {
            const quantity = await this.waitFor(this.services.cart.add(
                {
                    productTemplateId: parseInt(addEl.dataset.productTemplateId),
                    productId: parseInt(addEl.dataset.productId),
                    quantity: 1,
                },
                { isConfigured: true, showQuantity: false },
            ));
            if (quantity && window.location.pathname === "/shop/cart") {
                // the cart page lines and summary are server-rendered
                window.location.reload();
                return;
            }
            this.refresh();
        } catch {
            // the cart service already showed the error to the shopper
        } finally {
            addEl.disabled = false;
        }
    }
}

registry.category("public.interactions").add("scita_smart_commerce.free_shipping_bar", ScitaFreeShippingBar);
