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
        _document: { "t-on-click": this.onDocumentClick },
        ".o_scita_vs_file": { "t-on-change": this.locked(this.onFileChange, true) },
        ".o_scita_vs_reset": { "t-on-click": this.reset },
    };

    setup() {
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

    async onFileChange(ev) {
        const file = ev.currentTarget.files && ev.currentTarget.files[0];
        if (!file) {
            return;
        }
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

        let result;
        try {
            result = await this.waitFor(rpc("/scita/visual_search", { image: dataUrl.split(",")[1] }));
        } catch {
            result = { error: _t("Something went wrong. Please try again.") };
        }
        this.setStatus("", false);
        if (result.error) {
            this.showError(result.error);
            return;
        }
        this.renderChips(result.chips || []);
        this.renderResults(result.products || []);
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
        label.className = "small text-muted me-1";
        label.textContent = _t("We see:");
        this.chips.append(label);
        for (const chip of chips) {
            const el = document.createElement("span");
            el.className = "badge rounded-pill text-bg-light border";
            el.textContent = chip;
            this.chips.append(el);
        }
    }

    renderResults(products) {
        if (!products.length) {
            this.showError(_t("We couldn't find similar products. Try another photo or browse the shop."));
            return;
        }
        for (const product of products) {
            const col = document.createElement("div");
            col.className = "col";
            const card = document.createElement("a");
            card.className = "card h-100 text-decoration-none text-reset o_scita_vs_card";
            card.href = product.url;
            const img = document.createElement("img");
            img.className = "card-img-top object-fit-contain p-2";
            img.loading = "lazy";
            img.alt = product.name;
            img.src = product.image;
            img.style.aspectRatio = "1 / 1";
            const body = document.createElement("div");
            body.className = "card-body p-2";
            const name = document.createElement("div");
            name.className = "small fw-bold text-truncate";
            name.textContent = product.name;
            body.append(name);
            if (product.price) {
                const price = document.createElement("div");
                price.className = "small";
                price.textContent = product.price;
                if (product.compare_price) {
                    const del = document.createElement("del");
                    del.className = "text-muted ms-1";
                    del.textContent = product.compare_price;
                    price.append(del);
                }
                body.append(price);
            }
            card.append(img, body);
            col.append(card);
            this.results.append(col);
        }
        this.status.textContent = _t("%s similar products", products.length);
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
        this.sync();
        const observer = new ResizeObserver(() => this.sync());
        observer.observe(this.el.parentElement);
        this.registerCleanup(() => observer.disconnect());
    }

    sync() {
        if (!this.submit.offsetParent) {
            return; // hidden: computed colours of a hidden box are not reliable
        }
        const style = getComputedStyle(this.submit);
        for (const prop of COPIED_STYLES) {
            this.el.style[prop] = style[prop];
        }
    }
}

registry.category("public.interactions").add("scita_smart_commerce.visual_search_button", ScitaVisualSearchButton);

