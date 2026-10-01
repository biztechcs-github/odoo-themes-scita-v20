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
        this.imageEl.src = src || this.el.dataset.defaultImgSrc;
    },
});