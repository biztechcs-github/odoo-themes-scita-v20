import { Interaction } from "@web/public/interaction";
import { registry } from "@web/core/registry";
import { arButtonLabel, detectArSupport, openArViewer } from "./ar_viewer";

/** Product page "View in 3D / AR" button (rendered server-side for products with a model). */
export class ScitaProductArButton extends Interaction {
    static selector = ".o_scita_ar_btn";
    dynamicContent = {
        _root: { "t-on-click.prevent": this.onClick },
        ".o_scita_ar_btn_label": { "t-out": () => this.label },
    };

    setup() {
        this.label = this.el.dataset.label3d;
    }

    async willStart() {
        this.label = arButtonLabel(await detectArSupport());
    }

    start() {
        // reached from the viewer's QR code (scanned on a desktop): open it on this phone
        if (new URLSearchParams(window.location.search).has("scita_3d")) {
            this.onClick();
        }
    }

    onClick() {
        const data = this.el.dataset;
        openArViewer({
            id: parseInt(data.productId) || undefined,
            name: data.name,
            glb: data.glb,
            usdz: data.usdz || undefined,
            poster: data.poster,
            placement: data.placement,
            scale: data.scale,
        }, { onProductPage: true });
    }
}

registry.category("public.interactions").add("scita_smart_commerce.product_ar_button", ScitaProductArButton);
