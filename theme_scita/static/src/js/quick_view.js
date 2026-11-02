/** @odoo-module **/

import { rpc } from '@web/core/network/rpc';
import wSaleUtils from "@theme_scita/js/compat/website_sale_utils";
import publicWidget from '@theme_scita/js/compat/public_widget';
import { setQuoteProduct } from "@theme_scita/js/request_quote";
import wishlistUtils from '@website_sale/js/wishlist_utils';
import { formatFloat } from '@web/core/utils/numbers';

odoo.define('theme_scita.quick_view', [], function (require) {
    'use strict';

    publicWidget.registry.quickView = publicWidget.Widget.extend({
        selector: "#wrapwrap",
        events: {
            'click .quick_view_sct_btn': 'quickViewData',
            'click .cart_view_sct_btn': 'cartViewData',
            "click .css_attribute_color": "_onMouseEnterSwatch",
        },


        //----------------------------------------------------------------------
        // Quick View Modal
        //----------------------------------------------------------------------
        quickViewData: function (ev) {
            const element = ev.currentTarget;
            const product_id = $(element).attr('data-id');
            rpc('/theme_scita/shop/quick_view', { product_id }).then((data) => {
                if (!data) {
                    return;
                }
                $("#shop_quick_view_modal").html(data).modal("show");

                $(".quick_cover").css("display", "block");

                //------------------------------------------------------------------
                // Quantity + / - Buttons in Quick View Modal
                //------------------------------------------------------------------
                $("#shop_quick_view_modal").off("click", ".js_quantity_plus, .js_quantity_minus")
                    .on("click", ".js_quantity_plus, .js_quantity_minus", function (ev) {
                        ev.preventDefault();
                        const $btn = $(ev.currentTarget);
                        const $input = $btn.closest('.js_main_product').find('input[name=\"add_qty\"]');
                        let currentQty = parseFloat($input.val()) || 1;

                        if ($btn.hasClass('js_quantity_plus')) {
                            currentQty += 1;
                        } else if ($btn.hasClass('js_quantity_minus') && currentQty > 1) {
                            currentQty -= 1;
                        }

                        $input.val(currentQty).trigger('change');
                    });



                // off() must use the same selector as on(), otherwise a handler is added on
                // every open and the product gets added once per previous open.
                $("#shop_quick_view_modal").off("click", "#add_to_cart")
                    .on("click", "#add_to_cart", async function (ev) {
                        ev.preventDefault();

                        const form = wSaleUtils.getClosestProductForm(ev.currentTarget);
                        let product_id = parseInt(form.querySelector("input[name=product_id]").value);
                        const quantityInput = form.querySelector("input[name=add_qty]");
                        const quantity = parseFloat(quantityInput?.value || 1);

                        try {
                            // a combination of "create variants dynamically" attributes has no
                            // variant until it is bought: create it, as Odoo's cart does
                            if (!product_id) {
                                product_id = await rpc("/sale/create_product_variant", {
                                    product_template_id: parseInt(form.querySelector("input[name=product_template_id]").value),
                                    product_template_attribute_value_ids: wSaleUtils.getSelectedAttributeValues(form),
                                });
                                if (!product_id) {
                                    return;
                                }
                            }
                            // Step 1: Add or update cart line via custom controller
                            const response = await rpc("/custom/cart/add_or_update", {
                                product_id: product_id,
                                quantity: quantity
                            });

                            if (response.error) {
                                // products this shortcut must not add (a combo needs its items
                                // chosen): open the product page, where Odoo configures them
                                const templateId = form.querySelector("input[name=product_template_id]")?.value;
                                if (templateId) {
                                    window.location.href = `/shop/${templateId}`;
                                }
                                return;
                            }

                            const line_id = response.line_id;
                            const qty = response.quantity;

                            // Step 2: Update cart via official Odoo 19 cart update
                            const params = {
                                product_id: product_id,
                                quantity: qty,
                                line_id: line_id
                            };

                            const data = await rpc("/shop/cart/update", params);

                            // Step 3: Update cart navbar safely
                            // Optional: Update quantity input in modal
                            if (quantityInput) {
                                quantityInput.value = quantity;
                            }

                            // redirect('/shop/cart');
                            window.location.href = "/shop/cart";

                        } catch (err) {
                            console.error("❌ RPC call failed:", err);
                        }
                    });

                //------------------------------------------------------------------
                // Wishlist Button
                //------------------------------------------------------------------
                $("#shop_quick_view_modal").off("click", "button.o_add_wishlist_dyn")
                    .on("click", "button.o_add_wishlist_dyn", async function (ev) {
                        ev.preventDefault();
                        const el = ev.currentTarget;
                        const form = wSaleUtils.getClosestProductForm(el);
                        let productId = parseInt(el.dataset.productProductId);

                        if (!productId) {
                            productId = await rpc('/sale/create_product_variant', {
                                product_template_id: parseInt(el.dataset.productTemplateId),
                                product_template_attribute_value_ids: wSaleUtils.getSelectedAttributeValues(form),
                            });
                        }

                        if (!productId || wishlistUtils.getWishlistProductIds().includes(productId)) return;

                        await rpc('/shop/wishlist/add', { product_id: productId });
                        wishlistUtils.addWishlistProduct(productId);
                        wishlistUtils.updateWishlistNavBar();
                        el.disabled = true; el.classList.add('disabled');

                        wSaleUtils.animateClone(
                            $(document.querySelector('.o_wsale_my_wish')),
                            $(document.querySelector('#product_detail_main') ?? el.closest('.o_cart_product') ?? form),
                            25,
                            40
                        );
                    });

                //------------------------------------------------------------------
                // Quantity Change
                //------------------------------------------------------------------
                $("#shop_quick_view_modal").off("change", ".js_main_product input[name='add_qty']").on("change", ".js_main_product input[name='add_qty']", function (ev) {
                    // Just trigger change, WebsiteSale listens inside page,
                    // but here we can refresh price explicitly if needed
                    $(ev.currentTarget).closest("form").trigger("change");
                });

                //------------------------------------------------------------------
                // Variant Change: any attribute (size pills, radios, selects). Colour
                // swatches go through _onMouseEnterSwatch (click), which does the same.
                // Odoo's product page interaction does not run in this modal: without
                // this, choosing another size kept the first variant (its name, image,
                // price, and the product added to the cart).
                //------------------------------------------------------------------
                $("#shop_quick_view_modal").off("change.scitaVariant").on(
                    "change.scitaVariant",
                    "input.js_variant_change, select.js_variant_change",
                    (ev) => {
                        if (ev.target.closest(".css_attribute_color")) {
                            return;
                        }
                        this._updateCombination($(ev.target).closest(".js_main_product, #product_detail"));
                    }
                );

                // Highlight active swatch
                $("#shop_quick_view_modal").off("change", ".list-inline-item .css_attribute_color").on("change", ".list-inline-item .css_attribute_color", function (ev) {
                    const $parent = $(ev.target).closest('.js_product');
                    $parent.find('.css_attribute_color').removeClass("active");
                    $parent.find('.css_attribute_color').filter(':has(input:checked)').addClass("active");
                });
                $('#shop_quick_view_modal').find('span.attribute_value').each(function () {
                    const $span = $(this);
                    if ($span.closest('li[name="variant_attribute"]').length) {
                        // Odoo 20 wraps the value in "<span class="text-muted"> - value</span>":
                        // hide the dash with it, or the label read "Color -"
                        const $wrap = $span.parent(".text-muted");
                        ($wrap.length ? $wrap : $span).hide();
                    }
                });
            });
        },

           _onMouseEnterSwatch: async function (ev) {
            const $swatch = $(ev.currentTarget);
            const $product = $swatch.closest('.js_main_product, #product_detail');

            $product.find('.css_attribute_color').removeClass("active");
            $swatch.addClass("active");
            await this._updateCombination($product);
        },

        /**
         * Load the selected combination (quick view modal / Scita product blocks) and show
         * it: product added to the cart, name, price and image. The variant's own image when
         * it has one, the product's main image otherwise (product.product image_1920).
         */
        _updateCombination: async function ($product) {
            // Odoo 20 product pages have no product_template_id input and handle variant
            // changes themselves (ProductPage); only act where the Scita inputs exist
            // (quick view modal / Scita product blocks), otherwise the RPC gets a null template.
            const templateId = parseInt($product.find('input[name="product_template_id"]').val());
            if (!templateId) {
                return;
            }
            const requestId = (this._combinationRequest = (this._combinationRequest || 0) + 1);
            const combinationInfo = await rpc('/website_sale/get_combination_info', {
                product_template_id: templateId,
                product_id: parseInt($product.find('input[name="product_id"]').val()),
                combination: wSaleUtils.getSelectedAttributeValues($product[0]),
                add_qty: parseInt($product.find('input[name="add_qty"]').val()) || 1,
            });
            if (requestId !== this._combinationRequest) {
                return; // the shopper changed the selection again meanwhile
            }
            const possible = combinationInfo.is_combination_possible !== false;
            $product.toggleClass('css_not_available', !possible);
            $product.find('#add_to_cart, .js_check_product').toggleClass('disabled', !possible);
            if (!possible) {
                return;
            }
            // product_id is false for a combination whose variant is not created yet
            // ("create variants dynamically"): add to cart creates it. Keeping the previous
            // variant's id here added that variant to the cart instead.
            $product.find('input[name="product_id"]').val(combinationInfo.product_id || '');
            if (combinationInfo.display_name) {
                $product.find('.product_detail_name').text(combinationInfo.display_name);
            }
            if (typeof combinationInfo.price === 'number') {
                $product.find('.oe_price .oe_currency_value').text(
                    formatFloat(combinationInfo.price, { digits: [69, 2] })
                );
            }
            const $scope = $product.closest('.modal').length ? $product.closest('.modal') : $product;
            // as on the product page: Add to Cart, or Contact Us when this combination can't be
            // sold (e.g. priced 0 with "Prevent sale of zero priced products")
            const canBuy = !combinationInfo.prevent_sale && !combinationInfo.is_sold_out;
            $scope.find('#add_to_cart_wrap, #add_to_cart_wrap .css_quantity')
                .toggleClass('d-inline-flex', canBuy).toggleClass('d-none', !canBuy);
            $scope.find('#contact_us_wrapper')
                .toggleClass('d-flex', !!combinationInfo.prevent_sale)
                .toggleClass('d-none', !combinationInfo.prevent_sale);
            // the price block starts hidden when the variant shown first has no price (hide_price,
            // e.g. priced 0 and not sold): show it again for a combination that has one
            $scope.find('.product_price')
                .toggleClass('d-inline-block', !combinationInfo.hide_price)
                .toggleClass('d-none', !!combinationInfo.hide_price);
            $scope.find('.product_detail_img').attr('src', combinationInfo.product_id
                ? `/web/image/product.product/${combinationInfo.product_id}/image_1920`
                : `/web/image/product.template/${templateId}/image_1920`);
        },




        //----------------------------------------------------------------------
        // Cart View Modal
        //----------------------------------------------------------------------
        cartViewData: function (ev) {
            // the button sits in a <form action="/shop/cart/update">: never submit it
            ev.preventDefault();
            const element = ev.currentTarget;
            const product_id = $(element).attr('data-id');
            rpc('/theme_scita/shop/cart_view', { product_id }).then(function (data) {
                if (!data) {
                    return;
                }
                $("#shop_cart_view_modal").html(data).modal("show");
            });
        },
    });

     publicWidget.registry.RequestQuoteCompare = publicWidget.Widget.extend({
         selector: '#request_for_quote_button',
         events: {
             'click': '_onRequestQuoteClick',
            },
            
        _onRequestQuoteClick(ev) {
            ev.preventDefault();
            // Set the product in the modal before it opens
            setQuoteProduct(ev.currentTarget);
        },
    });
});
