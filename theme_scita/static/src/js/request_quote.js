/** @odoo-module **/

import publicWidget from '@theme_scita/js/compat/public_widget';

publicWidget.registry.SetProductIdModal = publicWidget.Widget.extend({
    selector: '#wrapwrap',

    events: {
        'click .request_for_quote_button': '_onRequestQuoteClick',
    },

    _onRequestQuoteClick(ev) {
        ev.preventDefault();

        const $btn = $(ev.currentTarget);
        // Buttons carry data-product_id or data-product-id depending on the template
        const productId = $btn.data('product_id') ?? $btn.data('product-id');
        $('#cfp_pop_up').find('#product_id').val(productId);
    },
});
