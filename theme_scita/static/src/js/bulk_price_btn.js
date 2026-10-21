/** @odoo-module **/

import publicWidget from '@theme_scita/js/compat/public_widget';
import { patch } from '@web/core/utils/patch';
import { ProductPage } from '@website_sale/interactions/product_page';

// The quantity input is the only state: a tier button just fills it in. The price shown and
// the quantity added to the cart then come from Odoo as for any quantity (the server prices
// the bulk tiers, see controllers/bulk_buy_product_discount.py). A remembered tier used to
// override both, so after "Buy 6" a quantity of 2 still showed the 6-unit price and added 6.

/**
 * Highlight the tier that applies to the quantity in the input: the largest minimum
 * quantity not above it (none below the first tier).
 */
function highlightBulkTier(productEl) {
    const qty = parseFloat(productEl.querySelector('input[name="add_qty"]')?.value) || 1;
    let best = null;
    for (const btn of productEl.querySelectorAll('.o_bulk_price_btn')) {
        btn.classList.remove('active');
        const min = parseFloat(btn.getAttribute('qty')) || 0;
        if (min <= qty && (!best || min > parseFloat(best.getAttribute('qty')))) {
            best = btn;
        }
    }
    best?.classList.add('active');
}

publicWidget.registry.BulkPriceButtonWidget = publicWidget.Widget.extend({
    selector: '.js_product',
    events: { 'click .o_bulk_price_btn': '_onBulkPriceClick' },

    _onBulkPriceClick: function (ev) {
        ev.preventDefault();
        const btn = ev.currentTarget;
        const el = btn.closest('.js_product');
        let qtyInput = el.querySelector('input[name="add_qty"]');
        if (!qtyInput) {
            // no quantity selector (Scita turns Odoo's off on install): the tier quantity goes in
            // a hidden field, the one Odoo's Add to Cart reads (else the click did nothing)
            qtyInput = document.createElement('input');
            Object.assign(qtyInput, { type: 'hidden', name: 'add_qty', value: '1' });
            el.prepend(qtyInput);
        }
        qtyInput.value = parseInt(btn.getAttribute('qty')) || 1;
        highlightBulkTier(el);
        // show the tier price right away; Odoo's combination update confirms it
        const price = parseFloat(btn.getAttribute('price'));
        const currencyVal = el.querySelector('.oe_price .oe_currency_value');
        if (currencyVal && !isNaN(price)) {
            currencyVal.textContent = price.toFixed(2);
        }
        // Odoo listens to `change` on the input: it re-prices the combination for this quantity
        qtyInput.dispatchEvent(new Event('change', { bubbles: true }));
    },
});

// Odoo 20: WebsiteSale became ProductPage and _onChangeCombination is async.
patch(ProductPage.prototype, {
    async _onChangeCombination(ev, parent, combination) {
        await super._onChangeCombination(...arguments);

        const bulkSection = parent.querySelector('#o_bulk_price_section');
        if (!bulkSection) return;

        const bulkPrices = combination.bulk_prices || [];
        const wrapper = bulkSection.querySelector('.o_bulk_price_wrapper');
        if (!bulkPrices.length || !wrapper) {
            bulkSection.classList.add('d-none');
            return;
        }
        bulkSection.classList.remove('d-none');

        // the tiers depend on the variant: rebuild them, then highlight the one in use
        wrapper.innerHTML = bulkPrices.map(rule =>
            `<a class="btn btn-outline-primary o_bulk_price_btn"
                 qty="${rule.min_quantity}"
                 price="${rule.fixed_price}"
                 href="#">
                <span class="buy-tag">Buy ${rule.min_quantity}</span>
                at
                <span class="buy-price">${rule.fixed_price.toFixed(2)}</span>
                / Unit
            </a>`
        ).join('');
        highlightBulkTier(parent);
    },
});
