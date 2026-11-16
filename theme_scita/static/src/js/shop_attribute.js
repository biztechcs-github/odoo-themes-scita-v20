/** @odoo-module **/

import publicWidget from "@theme_scita/js/compat/public_widget";

publicWidget.registry.ScitaProductPreviewAttribute = publicWidget.Widget.extend({
    selector: ".scita_attribute_select",
    events: {
        "mouseenter .scita_attribute_li": "_onMouseEnterSwatch",
        "mouseleave": "_onMouseLeave",
    },
    start: function () {
        // Odoo 20 shop cards are <article class="oe_product_cart">, Scita snippet cards are still forms
        const card = this.el.closest('form') || this.el.closest('.oe_product_cart');
        this.imageEl = card ? card.querySelector('img') : null;
        // Odoo 20 card images have a srcset, which the browser shows instead of src: keep the
        // original ones to put back
        this.defaultSrc = this.imageEl && this.imageEl.getAttribute('src');
        this.defaultSrcset = this.imageEl && this.imageEl.getAttribute('srcset');
        return this._super.apply(this, arguments);
    },
    _onMouseEnterSwatch: function (ev) {
        const element = ev.currentTarget.querySelector('label, a.css_attribute_color');
        if (element && element.dataset.previewImgSrc) {
            this._updateImgSrc(element.dataset.previewImgSrc);
            ev.currentTarget.classList.add("active");
        }
    },
    _onMouseLeave: function () {
        this._updateImgSrc();
    },
    _updateImgSrc: function (src=false) {
        if (!this.imageEl) {
            return;
        }
        if (src) {
            this.imageEl.removeAttribute('srcset'); // else the variant image never shows
            this.imageEl.src = src;
            return;
        }
        this.imageEl.src = this.defaultSrc || this.el.dataset.defaultImgSrc;
        if (this.defaultSrcset) {
            this.imageEl.setAttribute('srcset', this.defaultSrcset);
        }
    },
});