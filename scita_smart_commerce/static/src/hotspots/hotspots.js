import { Interaction } from "@web/public/interaction";
import { registry } from "@web/core/registry";
import { rpc } from "@web/core/network/rpc";
import { _t } from "@web/core/l10n/translation";
import { arButtonLabel, detectArSupport, openArViewer } from "@scita_smart_commerce/hotspot_ar/ar_viewer";

const SPOT = ".o_scita_hotspot";

// ------------------------------------------------------------------ product data
// Every hotspot area of the page asks for its products: one request for all of them.
let batch = null;

function loadProducts(ids) {
    if (!batch) {
        const current = { ids: new Set(), promise: null };
        batch = current;
        current.promise = new Promise((resolve) => setTimeout(resolve, 0)).then(async () => {
            batch = null;
            try {
                const res = await rpc("/scita/hotspots/products", { product_ids: [...current.ids] });
                return res.products || {};
            } catch {
                return {};
            }
        });
    }
    ids.forEach((id) => batch.ids.add(id));
    return batch.promise;
}

let arLabelPromise = null;
function arLabel() {
    arLabelPromise ||= detectArSupport().then(arButtonLabel, () => arButtonLabel(false));
    return arLabelPromise;
}

/**
 * Product hotspots on any image of any block (an <img> or a block with a background image).
 * The website editor puts `.o_scita_hotspot` dots (with `data-product-template-id` and a
 * position in %) inside the `.o_scita_hotspots` area; here a dot opens its product card with
 * the live price and stock for this visitor. Dots of products the visitor can't see are hidden.
 */
export class ScitaHotspots extends Interaction {
    static selector = ".o_scita_hotspots";
    dynamicContent = {
        [`:scope > ${SPOT}`]: {
            "t-on-click": this.onSpotClick,
            "t-on-keydown": this.onSpotKeydown,
        },
        _root: { "t-on-click": this.onCardClick },
        _document: {
            "t-on-click": this.onDocumentClick,
            "t-on-keydown": this.onDocumentKeydown,
        },
    };

    setup() {
        this.spots = [...this.el.querySelectorAll(`:scope > ${SPOT}`)];
        this.products = {};
        this.cardEl = null;
        this.arLabel = arButtonLabel(false);
    }

    async willStart() {
        const ids = [...new Set(this.spots.map((s) => parseInt(s.dataset.productTemplateId)).filter(Boolean))];
        if (!ids.length) {
            return;
        }
        this.products = await loadProducts(ids);
        if (ids.some((id) => this.products[id]?.has_ar)) {
            this.arLabel = await arLabel();
        }
    }

    start() {
        let index = 0;
        const numbers = {};
        for (const spot of this.spots) {
            const product = this.products[spot.dataset.productTemplateId];
            if (!product) {
                this.setClass(spot, "d-none", true);
                continue;
            }
            numbers[product.id] ||= ++index;
            this.setAttr(spot, "data-hotspot-index", String(numbers[product.id]));
            this.setAttr(spot, "aria-label", product.name);
            this.setAttr(spot, "aria-haspopup", "dialog");
            this.setAttr(spot, "aria-expanded", "false");
        }
        this.setClass(this.el, "o_scita_hotspots_ready", true);
    }

    /** Change server-rendered nodes, undone when the interaction stops (e.g. editor opens). */
    setAttr(el, name, value) {
        const previous = el.getAttribute(name);
        el.setAttribute(name, value);
        this.registerCleanup(() => (previous === null ? el.removeAttribute(name) : el.setAttribute(name, previous)));
    }

    setClass(el, className, force) {
        const had = el.classList.contains(className);
        el.classList.toggle(className, force);
        this.registerCleanup(() => el.classList.toggle(className, had));
    }

    // ------------------------------------------------------------ card

    onSpotClick(ev) {
        ev.preventDefault();
        ev.stopPropagation(); // e.g. a banner slide link or carousel behind the dot
        const spot = ev.currentTarget;
        if (this.cardSpot === spot) {
            this.closeCard(true);
            return;
        }
        const product = this.products[spot.dataset.productTemplateId];
        if (product) {
            this.openCard(spot, product);
        }
    }

    onSpotKeydown(ev) {
        if (ev.key === "Enter" || ev.key === " ") {
            this.onSpotClick(ev);
        }
    }

    openCard(spot, product) {
        this.closeCard();
        const [card] = this.renderAt("scita_smart_commerce.HotspotCard", { product, arLabel: this.arLabel }, this.el);
        const x = parseFloat(spot.style.left) || 50;
        const y = parseFloat(spot.style.top) || 50;
        // open towards the free side of the image
        card.classList.add(x > 50 ? "o_scita_hotspot_card_left" : "o_scita_hotspot_card_right",
            y > 55 ? "o_scita_hotspot_card_up" : "o_scita_hotspot_card_down");
        card.style.left = `${x}%`;
        card.style.top = `${y}%`;
        this.cardEl = card;
        this.cardSpot = spot;
        spot.setAttribute("aria-expanded", "true");
        spot.classList.add("o_scita_hotspot_active");
        // preventScroll: the area may be overflow hidden (banner slides), never scroll its content
        card.querySelector(".o_scita_hotspot_card_name")?.focus({ preventScroll: true });
    }

    closeCard(restoreFocus = false) {
        if (!this.cardEl) {
            return;
        }
        this.cardEl.remove();
        this.cardEl = null;
        this.cardSpot.setAttribute("aria-expanded", "false");
        this.cardSpot.classList.remove("o_scita_hotspot_active");
        if (restoreFocus) {
            this.cardSpot.focus({ preventScroll: true });
        }
        this.cardSpot = null;
    }

    onDocumentClick(ev) {
        if (this.cardEl && !this.cardEl.contains(ev.target) && !this.spots.includes(ev.target.closest(SPOT))) {
            this.closeCard();
        }
    }

    onDocumentKeydown(ev) {
        if (ev.key === "Escape" && this.cardEl && !document.querySelector(".o_scita_ar_modal.show")) {
            this.closeCard(true);
        }
    }

    async onCardClick(ev) {
        if (!this.cardEl?.contains(ev.target)) {
            return;
        }
        ev.stopPropagation(); // the card lives inside the image block: don't trigger its links
        const target = ev.target.closest(".o_scita_hotspot_card_close, .o_scita_hotspot_card_add, .o_scita_hotspot_card_ar");
        if (!target) {
            return;
        }
        ev.preventDefault();
        const product = this.products[this.cardSpot.dataset.productTemplateId];
        if (target.matches(".o_scita_hotspot_card_close")) {
            this.closeCard(true);
        } else if (target.matches(".o_scita_hotspot_card_ar")) {
            await openArViewer({
                name: product.name,
                glb: product.ar.glb,
                usdz: product.ar.usdz,
                poster: product.image_url,
                placement: product.ar.placement,
                scale: product.ar.scale,
            });
        } else {
            await this.addToCart(target, product);
        }
    }

    async addToCart(button, product) {
        if (button.disabled) {
            return;
        }
        button.disabled = true;
        const label = button.innerHTML;
        try {
            await this.waitFor(this.services.cart.add(
                { productTemplateId: product.id, productId: product.product_id, quantity: 1 },
                { isConfigured: true, showQuantity: false },
            ));
            button.textContent = _t("Added ✓");
            this.waitForTimeout(() => {
                button.innerHTML = label;
                button.disabled = false;
            }, 2000);
        } catch {
            button.innerHTML = label;
            button.disabled = false;
        }
    }
}

registry.category("public.interactions").add("scita_smart_commerce.hotspots", ScitaHotspots);
