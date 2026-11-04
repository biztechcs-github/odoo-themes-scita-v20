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

// The area whose card is open: one card on the page at a time. Clicks on a dot or a card don't
// reach the document (stopPropagation), so another area's outside-click close never runs.
let openArea = null;

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
// phones and tablets: a hotspot's mobile position and "Show on" (as hotspots.scss)
const MOBILE_QUERY = "(max-width: 991.98px)";
const isMobile = () => window.matchMedia(MOBILE_QUERY).matches;
// phones: the card is a sheet at the bottom of the image (hotspots.scss, below "sm")
const PHONE_QUERY = "(max-width: 575.98px)";
const SHEET_WIDTH = 320; // the card's width elsewhere
const SHEET_MARGIN = 8; // px, from the image / screen edges (0.5rem)
const CARD_GAP = 28; // px between the dot and its card (the card's translate, hotspots.scss)
/** Whether a hotspot is hidden on this device ("Show on" option). */
const isHiddenHere = (spot) =>
    spot.classList.contains(isMobile() ? "o_scita_hotspot_hide_mobile" : "o_scita_hotspot_hide_desktop");
/** Left / top of a hotspot (in %) on this device. */
function spotPosition(spot, property) {
    const value = isMobile() && spot.classList.contains("o_scita_hotspot_m_pos")
        ? spot.style.getPropertyValue(`--scita-hotspot-m-${property}`)
        : spot.style[property];
    return parseFloat(value) || 50;
}

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
        for (const spot of this.spots) {
            // left by a page saved while a card was open (fixed in the editor since)
            spot.classList.remove("o_scita_hotspot_active");
            const product = this.products[spot.dataset.productTemplateId];
            if (!product) {
                this.setClass(spot, "d-none", true);
                continue;
            }
            this.setAttr(spot, "aria-label", product.name);
            this.setAttr(spot, "aria-haspopup", "dialog");
            this.setAttr(spot, "aria-expanded", "false");
        }
        this.numberSpots();
        this.registerCleanup(() => this.spots.forEach((spot) => spot.removeAttribute("data-hotspot-index")));
        // desktop <-> mobile (rotating a tablet, resizing): other hotspots shown, at other places
        const mediaQuery = window.matchMedia(MOBILE_QUERY);
        const onDeviceChange = () => {
            this.closeCard();
            this.numberSpots();
        };
        mediaQuery.addEventListener("change", onDeviceChange);
        this.registerCleanup(() => mediaQuery.removeEventListener("change", onDeviceChange));
        this.setClass(this.el, "o_scita_hotspots_ready", true);
    }

    /** "Number" style: 1, 2, 3... over the hotspots shown on this device (one number per product). */
    numberSpots() {
        let index = 0;
        const numbers = {};
        for (const spot of this.spots) {
            const product = this.products[spot.dataset.productTemplateId];
            if (!product || isHiddenHere(spot)) {
                spot.removeAttribute("data-hotspot-index");
                continue;
            }
            numbers[product.id] ||= ++index;
            spot.setAttribute("data-hotspot-index", String(numbers[product.id]));
        }
    }

    destroy() {
        // e.g. the editor opens: don't leave a card (or a stale openArea) behind
        this.closeCard();
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
        if (openArea && openArea !== this) {
            openArea.closeCard();
        }
        openArea = this;
        const [card] = this.renderAt("scita_smart_commerce.HotspotCard", { product, arLabel: this.arLabel }, this.el);
        // where the dot is on this device (its mobile position on phones and tablets)
        const x = spotPosition(spot, "left");
        const y = spotPosition(spot, "top");
        // open towards the free side of the image
        card.classList.add(x > 50 ? "o_scita_hotspot_card_left" : "o_scita_hotspot_card_right",
            y > 55 ? "o_scita_hotspot_card_up" : "o_scita_hotspot_card_down");
        card.style.left = `${x}%`;
        card.style.top = `${y}%`;
        // keep it on screen: on a phone the image is narrower than the card on either side of
        // the dot (a dot at 70% of a 354px banner slide opened the card off the left edge).
        // Where it lands is worked out from the dot, not measured: it is measured while its
        // opening animation shrinks it (scale 0.94), and the shift came out ~40px short on a
        // tablet (the card still went off the left edge).
        const area = this.el.getBoundingClientRect();
        const width = card.offsetWidth;
        const dotX = area.left + (area.width * x) / 100;
        const cardLeft = x > 50 ? dotX - CARD_GAP - width : dotX + CARD_GAP;
        const margin = 8;
        const viewWidth = document.documentElement.clientWidth;
        let shift = 0;
        if (cardLeft < margin) {
            shift = margin - cardLeft;
        } else if (cardLeft + width > viewWidth - margin) {
            shift = viewWidth - margin - (cardLeft + width);
        }
        if (shift) {
            card.style.marginLeft = `${shift}px`;
        }
        this.fitSheetOnPhone(card);
        this.cardEl = card;
        this.cardSpot = spot;
        spot.setAttribute("aria-expanded", "true");
        spot.classList.add("o_scita_hotspot_active");
        // preventScroll: the area may be overflow hidden (banner slides), never scroll its content
        card.querySelector(".o_scita_hotspot_card_name")?.focus({ preventScroll: true });
    }

    /**
     * Phones: the card is a sheet across the bottom of the image (hotspots.scss). On a small
     * image (a cell of an image grid, two images side by side...) that sheet was as narrow as the
     * image (~160px): the product name was cut to a few letters. There it takes the card's
     * width (or the screen's), centred on the image and kept on the screen.
     */
    fitSheetOnPhone(card) {
        if (!window.matchMedia(PHONE_QUERY).matches) {
            return;
        }
        const area = this.el.getBoundingClientRect();
        const viewWidth = document.documentElement.clientWidth;
        const width = Math.min(SHEET_WIDTH, viewWidth - 2 * SHEET_MARGIN);
        if (area.width - 2 * SHEET_MARGIN >= width) {
            return; // a wide image: the sheet across it is wide enough
        }
        const left = Math.min(
            Math.max(area.left + area.width / 2 - width / 2, SHEET_MARGIN),
            viewWidth - SHEET_MARGIN - width
        );
        // !important: the phone sheet's left / right / width are (hotspots.scss)
        card.style.setProperty("width", `${width}px`, "important");
        card.style.setProperty("left", `${left - area.left}px`, "important");
        card.style.setProperty("right", "auto", "important");
    }

    closeCard(restoreFocus = false) {
        if (!this.cardEl) {
            return;
        }
        this.cardEl.remove();
        this.cardEl = null;
        if (openArea === this) {
            openArea = null;
        }
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
                id: product.id,
                name: product.name,
                glb: product.ar.glb,
                usdz: product.ar.usdz,
                poster: product.image_url,
                placement: product.ar.placement,
                scale: product.ar.scale,
            }, {
                info: product,
                addToCart: (button) => this.addToCart(button, product),
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
