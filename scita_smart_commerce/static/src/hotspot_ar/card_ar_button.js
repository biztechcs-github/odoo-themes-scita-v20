import { Interaction } from "@web/public/interaction";
import { registry } from "@web/core/registry";
import { rpc } from "@web/core/network/rpc";
import { _t } from "@web/core/l10n/translation";
import { openArViewer } from "./ar_viewer";

/**
 * "3D" button on product cards (shop grid, Scita product snippets): opens the 3D viewer in place,
 * the shopper stays on the list. Listened to on the whole page: snippet cards are rendered after
 * the page loads, and carousels clone them.
 */
export class ScitaCardArButton extends Interaction {
    static selector = "#wrapwrap";

    start() {
        // capture: before the card's own handlers (links, quick view, carousel drag)
        this.addListener(this.el, "click", this.onClick, { capture: true });
    }

    async onClick(ev) {
        const button = ev.target.closest(".o_scita_ar_card_btn");
        if (!button) {
            return;
        }
        ev.preventDefault();
        ev.stopPropagation();
        if (button.classList.contains("o_scita_ar_card_btn_loading")) {
            return;
        }
        button.classList.add("o_scita_ar_card_btn_loading");
        const label = button.querySelector(".o_scita_ar_card_btn_long");
        const text = label.textContent;
        label.textContent = _t("Loading…");
        let product = null;
        try {
            const id = parseInt(button.dataset.productId);
            const { products } = await this.waitFor(rpc("/scita/hotspots/products", { product_ids: [id] }));
            product = products[id];
        } catch {
            // no card: the viewer can't be opened
        } finally {
            button.classList.remove("o_scita_ar_card_btn_loading");
            label.textContent = text;
        }
        if (!product?.has_ar || !product.ar?.glb) {
            return; // unpublished, or its model removed since the page was rendered
        }
        await openArViewer({
            id: product.id,
            name: product.name,
            glb: product.ar.glb,
            usdz: product.ar.usdz,
            poster: product.image_url,
            placement: product.ar.placement,
            scale: product.ar.scale,
        }, {
            info: product,
            addToCart: (cartButton) => this.addToCart(cartButton, product),
        });
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

registry.category("public.interactions").add("scita_smart_commerce.card_ar_button", ScitaCardArButton);
