/** @odoo-module **/

import publicWidget from '@theme_scita/js/compat/public_widget';

/** Request Quote pop-up (#cfp_pop_up, one per page): the product of the button that opens it. */
export function setQuoteProduct(btn) {
    const modal = document.getElementById("cfp_pop_up");
    if (!modal) {
        return;
    }
    // Buttons carry data-product_id or data-product-id depending on the template
    const productId = btn.dataset.product_id ?? btn.dataset.productId;
    modal.querySelector("#product_id").value = productId || "";
    const name = btn.dataset.productName;
    const box = modal.querySelector(".sct_quote_product");
    if (box) {
        let nameEl = box.querySelector(".sct_quote_product_name");
        if (!nameEl) {
            // pages rendered by an older version of the template have no name element
            nameEl = document.createElement("span");
            nameEl.className = "sct_quote_product_name";
            box.append(nameEl);
        }
        nameEl.textContent = name || "";
        box.classList.toggle("d-none", !name);
    }
}

publicWidget.registry.SetProductIdModal = publicWidget.Widget.extend({
    selector: '#wrapwrap',

    events: {
        'click .request_for_quote_button': '_onRequestQuoteClick',
    },

    _onRequestQuoteClick(ev) {
        ev.preventDefault();
        setQuoteProduct(ev.currentTarget);
    },
});
