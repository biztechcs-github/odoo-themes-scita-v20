/** @odoo-module **/

import publicWidget from '@theme_scita/js/compat/public_widget';
import wishlistUtils from '@website_sale/js/wishlist_utils';
import { rpc } from '@web/core/network/rpc';
import wSaleUtils from '@theme_scita/js/compat/website_sale_utils';
import { patch } from '@web/core/utils/patch';
import { AddToWishlist } from '@website_sale/interactions/add_to_wishlist';
import { AddToComparison } from '@website_sale/interactions/add_to_comparison';

// Scita's card links (`a[data-action="o_wishlist"]`, `a[data-action="scita_comparelist"]`)
// carry the variant in data-product-product-id and are handled by the theme below and in
// product_comparison_extend.js. They also have Odoo's .o_add_wishlist / .o_add_compare
// classes (the card styles rely on them), so on server-rendered pages (/deals-of-the-day)
// Odoo 20's own interactions handled the same click too: without data-product-id they asked
// /sale/create_product_variant for template `null` and showed an error dialog.
const isScitaWishlistLink = (el) => el.matches('a[data-action="o_wishlist"]');
const isScitaCompareLink = (el) => el.matches('a[data-action="scita_comparelist"]');
patch(AddToWishlist.prototype, {
    addProduct(ev) {
        if (isScitaWishlistLink(ev.currentTarget)) {
            return;
        }
        return super.addProduct(...arguments);
    },
});
patch(AddToComparison.prototype, {
    addProduct(ev) {
        if (isScitaCompareLink(ev.currentTarget)) {
            return;
        }
        return super.addProduct(...arguments);
    },
});

publicWidget.registry.ThemeWishlistFix = publicWidget.Widget.extend({
    selector: "#wrapwrap",
    events: {
        'click a[data-action="o_wishlist"]': '_onAddToWishlist',
    },

    async _onAddToWishlist(ev) {
        ev.preventDefault();
        const el = ev.currentTarget;
        const productId = parseInt(el.dataset.productProductId);
        const form = wSaleUtils.getClosestProductForm(el);

        if (!productId) {
            console.warn("❌ No product ID found for wishlist");
            return;
        }

        if (!productId || wishlistUtils.getWishlistProductIds().includes(productId)) return;

        try {
            await rpc('/shop/wishlist/add', { product_id: productId });
            wishlistUtils.addWishlistProduct(productId);
            wishlistUtils.updateWishlistNavBar();
            el.disabled = true; el.classList.add('disabled');
            await wSaleUtils.animateClone(
                $(document.querySelector('.o_wsale_my_wish')),
                $(document.querySelector('#product_detail_main') ?? el.closest('.o_cart_product') ?? form),
                25,
                40,
            );
            if (el.classList.contains('o_add_wishlist')) {
                const iconEl = el.querySelector('.fa');
                if (iconEl) {
                    iconEl.classList.remove('fa-heart-o');
                    iconEl.classList.add('fa-heart');
                }
            }
        } catch (err) {
            // console.error("Wishlist add failed:", err);
        }
    },
});
