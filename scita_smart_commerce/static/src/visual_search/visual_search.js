import { Interaction } from "@web/public/interaction";
import { registry } from "@web/core/registry";
import { rpc } from "@web/core/network/rpc";
import { _t } from "@web/core/l10n/translation";

const MAX_SIDE = 1024;
const JPEG_QUALITY = 0.85;

/**
 * Downscale an image file to at most MAX_SIDE px on its longest side and
 * return it as a JPEG data URL (smaller upload, faster AI call).
 */
export async function downscaleImage(file) {
    const url = URL.createObjectURL(file);
    try {
        const img = await new Promise((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = () => reject(new Error("invalid image"));
            el.src = url;
        });
        const ratio = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.naturalWidth * ratio));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * ratio));
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff"; // transparent PNGs become white, not black, in JPEG
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    } finally {
        URL.revokeObjectURL(url);
    }
}

export class ScitaVisualSearch extends Interaction {
    static selector = "#o_scita_visual_search_modal";
    dynamicContent = {
        // capture phase: the camera button may sit in a search box that opens Odoo's own search
        // pop-up on any click (mobile menu, data-force-modal-trigger): that pop-up opened on top
        // of this one and covered it. Handled (and stopped) before the search box sees it.
        _document: { "t-on-click.capture": this.onDocumentClick },
        ".o_scita_vs_file": { "t-on-change": this.locked(this.onFileChange, true) },
        ".o_scita_vs_reset": { "t-on-click": this.reset },
        // drag and drop a photo on the picker
        ".o_scita_vs_drop": {
            "t-on-dragover": this.onDragOver,
            "t-on-dragleave": this.onDragLeave,
            "t-on-drop": this.locked(this.onDrop, true),
            "t-att-class": () => ({ o_scita_vs_dragging: this.dragging }),
        },
    };

    setup() {
        this.dragging = false;
        this.picker = this.el.querySelector(".o_scita_vs_picker");
        this.preview = this.el.querySelector(".o_scita_vs_preview");
        this.previewImg = this.el.querySelector(".o_scita_vs_preview_img");
        this.status = this.el.querySelector(".o_scita_vs_status");
        this.chips = this.el.querySelector(".o_scita_vs_chips");
        this.error = this.el.querySelector(".o_scita_vs_error");
        this.results = this.el.querySelector(".o_scita_vs_results");
        this.footer = this.el.querySelector(".o_scita_vs_footer");
        this.allLink = this.el.querySelector(".o_scita_vs_all");
    }

    onDocumentClick(ev) {
        if (!ev.target.closest(".o_scita_visual_search_btn")) {
            return;
        }
        ev.preventDefault();
        ev.stopPropagation();
        // the button may live inside the search modal: close it first
        const openModal = ev.target.closest(".modal.show");
        if (openModal && openModal !== this.el) {
            window.Modal.getOrCreateInstance(openModal).hide();
        }
        this.reset();
        window.Modal.getOrCreateInstance(this.el).show();
    }

    reset() {
        this.el.querySelectorAll(".o_scita_vs_file").forEach((input) => (input.value = ""));
        this.picker.classList.remove("d-none");
        this.preview.classList.add("d-none");
        this.previewImg.removeAttribute("src");
        this.status.textContent = "";
        this.chips.replaceChildren();
        this.results.replaceChildren();
        this.footer.classList.add("d-none");
        this.showError("");
    }

    showError(message) {
        this.error.textContent = message;
        this.error.classList.toggle("d-none", !message);
    }

    onDragOver(ev) {
        if ([...(ev.dataTransfer?.types || [])].includes("Files")) {
            ev.preventDefault(); // allows the drop
            ev.dataTransfer.dropEffect = "copy";
            this.dragging = true;
        }
    }

    onDragLeave(ev) {
        if (!ev.currentTarget.contains(ev.relatedTarget)) {
            this.dragging = false;
        }
    }

    async onDrop(ev) {
        ev.preventDefault(); // else the browser opens the image
        this.dragging = false;
        const file = ev.dataTransfer?.files?.[0];
        if (file) {
            await this.processFile(file);
        }
    }

    async onFileChange(ev) {
        const file = ev.currentTarget.files && ev.currentTarget.files[0];
        if (file) {
            await this.processFile(file);
        }
    }

    async processFile(file) {
        if (!file.type.startsWith("image/")) {
            this.showError(_t("Please choose an image file."));
            return;
        }
        let dataUrl;
        try {
            dataUrl = await this.waitFor(downscaleImage(file));
        } catch {
            this.showError(_t("This file is not a valid image."));
            return;
        }
        this.picker.classList.add("d-none");
        this.preview.classList.remove("d-none");
        this.previewImg.src = dataUrl;
        this.showError("");
        this.results.replaceChildren();
        this.chips.replaceChildren();
        this.footer.classList.add("d-none");
        this.setStatus(_t("Looking for similar products…"), true);
        this.results.replaceChildren(...Array.from({ length: 4 }, () => {
            const placeholder = document.createElement("div");
            placeholder.className = "o_scita_vs_card o_scita_vs_card_loading";
            placeholder.setAttribute("aria-hidden", "true");
            return placeholder;
        }));

        let result;
        try {
            result = await this.waitFor(rpc("/scita/visual_search", { image: dataUrl.split(",")[1] }));
        } catch {
            result = { error: _t("Something went wrong. Please try again.") };
        }
        this.setStatus("", false);
        this.results.replaceChildren();
        if (result.error) {
            this.showError(result.error);
            return;
        }
        this.renderChips(result.chips || []);
        this.renderResults(result.products || [], result.exact !== false);
        if (result.search_url) {
            this.allLink.href = result.search_url;
            this.footer.classList.remove("d-none");
        }
    }

    setStatus(text, busy) {
        this.status.replaceChildren();
        if (busy) {
            const spinner = document.createElement("span");
            spinner.className = "spinner-border spinner-border-sm me-2";
            spinner.setAttribute("aria-hidden", "true");
            this.status.append(spinner);
        }
        this.status.append(document.createTextNode(text));
    }

    renderChips(chips) {
        if (!chips.length) {
            return;
        }
        const label = document.createElement("span");
        label.className = "o_scita_vs_chips_label";
        label.textContent = _t("We see:");
        this.chips.append(label);
        for (const chip of chips) {
            const el = document.createElement("span");
            el.className = "o_scita_vs_chip";
            el.textContent = chip;
            this.chips.append(el);
        }
    }

    renderResults(products, exact = true) {
        if (!products.length) {
            this.showError(_t("We couldn't find similar products. Try another photo or browse the shop."));
            return;
        }
        for (const product of products) {
            const card = document.createElement("a");
            card.className = "o_scita_vs_card";
            card.href = product.url;
            const media = document.createElement("span");
            media.className = "o_scita_vs_card_img";
            const img = document.createElement("img");
            img.loading = "lazy";
            img.alt = product.name;
            img.src = product.image;
            media.append(img);
            const body = document.createElement("span");
            body.className = "o_scita_vs_card_body";
            const name = document.createElement("span");
            name.className = "o_scita_vs_card_name";
            name.textContent = product.name;
            body.append(name);
            if (product.price) {
                const price = document.createElement("span");
                price.className = "o_scita_vs_card_price";
                price.textContent = product.price;
                if (product.compare_price) {
                    const del = document.createElement("del");
                    del.textContent = product.compare_price;
                    price.append(del);
                }
                body.append(price);
            }
            card.append(media, body);
            this.results.append(card);
        }
        if (!exact) {
            // nothing of the photo's kind in the shop: say so, these are only related products
            this.status.textContent = products.length === 1
                ? _t("We don't have this product. 1 related product:")
                : _t("We don't have this product. %s related products:", products.length);
        } else {
            this.status.textContent = products.length === 1
                ? _t("1 similar product")
                : _t("%s similar products", products.length);
        }
    }
}

registry.category("public.interactions").add("scita_smart_commerce.visual_search", ScitaVisualSearch);

/**
 * Camera button inside the search box, Google-style: between the text and the search button,
 * looking like part of the same field. Search boxes differ per header (outline, filled,
 * pill...), so it takes the look of the box's own search button instead of fixed colours,
 * again whenever the box resizes (a hidden mobile-menu search box measures nothing).
 */
const COPIED_STYLES = [
    "backgroundColor", "color",
    "borderTopWidth", "borderTopStyle", "borderTopColor",
    "borderBottomWidth", "borderBottomStyle", "borderBottomColor",
];

export class ScitaVisualSearchButton extends Interaction {
    static selector = ".o_scita_visual_search_btn";

    start() {
        if (this.el.classList.contains("d-none") && document.getElementById("o_scita_visual_search_modal")) {
            this.el.classList.remove("d-none"); // the search pop-up's camera: feature enabled
        }
        this.submit = this.el.parentElement?.querySelector(":scope > button[type='submit']");
        if (!this.submit) {
            return;
        }
        // in the next frame, not while the page starts: reading the computed style then made
        // the browser restyle the whole page each time (~250ms on a mid-range phone)
        const observer = new ResizeObserver(() => this.scheduleSync());
        observer.observe(this.el.parentElement);
        this.registerCleanup(() => {
            observer.disconnect();
            cancelAnimationFrame(this.syncFrame);
        });
    }

    scheduleSync() {
        cancelAnimationFrame(this.syncFrame);
        this.syncFrame = requestAnimationFrame(() => this.sync());
    }

    sync() {
        if (!this.submit.offsetParent) {
            return; // hidden: computed colours of a hidden box are not reliable
        }
        const style = getComputedStyle(this.submit);
        const values = COPIED_STYLES.map((prop) => style[prop]); // all reads before any write
        COPIED_STYLES.forEach((prop, i) => {
            if (this.el.style[prop] !== values[i]) {
                this.el.style[prop] = values[i];
            }
        });
    }
}

registry.category("public.interactions").add("scita_smart_commerce.visual_search_button", ScitaVisualSearchButton);

