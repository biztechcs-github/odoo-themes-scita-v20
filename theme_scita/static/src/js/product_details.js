/** @odoo-module **/
/**
 * Product page helpers (Odoo 20).
 *
 * Kept from 19 (unchanged behaviour): recommended products slider, the
 * mobile / product-page body classes and the delivery zip-code checker.
 *
 * Dropped because they were never called on 19 either:
 *  - VariantMixin._onChangeCombinationProd (nothing referenced it)
 *  - WebsiteSale.onVariantChange / _onClickSubmit patches (19's WebsiteSale
 *    had no such methods, so the patch only added unused ones)
 *
 * Added for Odoo 20: Scita wraps the add-to-cart button in its own markup, so
 * the button is no longer a direct child of #add_to_cart_wrap. Odoo uses that
 * parent check to know the product was configured on the page; without this
 * patch the product configurator would reopen on every add to cart.
 */

import { _t } from "@web/core/l10n/translation";
import { rpc } from "@web/core/network/rpc";
import { patch } from "@web/core/utils/patch";
import { AddToCart } from "@website_sale/interactions/add_to_cart";
import { ProductPage } from "@website_sale/interactions/product_page";

// SKU line (Settings > "Display product reference"): show the reference of the variant the
// customer picks, as Scita did up to 18 (19's handler for it was never called).
patch(ProductPage.prototype, {
    async _onChangeCombination(ev, parent, combination) {
        await super._onChangeCombination(...arguments);
        const scope = parent.closest(".modal-content, #product_detail, main") || document;
        const skuWrap = scope.querySelector(".sct-sku-display-div");
        if (!skuWrap || skuWrap.dataset.show !== "1" || !combination.product_id) {
            return;
        }
        // Fast variant clicks: only the latest answer may write the SKU.
        const requestId = (this._skuRequest = (this._skuRequest || 0) + 1);
        const data = await rpc("/shop/variant_change", { pro_id: combination.product_id });
        if (requestId !== this._skuRequest) {
            return;
        }
        skuWrap.replaceChildren();
        if (data.default_code) {
            const line = document.createElement("p");
            line.className = "sct-sku-display";
            const code = document.createElement("span");
            code.className = "sct-default-code";
            code.textContent = data.default_code;
            line.append(_t("SKU: "), code);
            skuWrap.append(line);
        }
    },
});

patch(AddToCart.prototype, {
    addToCart(ev) {
        const button = ev.currentTarget;
        const wrap = button.closest("#add_to_cart_wrap");
        if (!wrap || button.parentElement === wrap) {
            return super.addToCart(ev);
        }
        // Core reads `button.parentElement.id` synchronously while building the
        // cart.add() options, i.e. before its first await.
        Object.defineProperty(button, "parentElement", { value: wrap, configurable: true });
        try {
            return super.addToCart(ev);
        } finally {
            delete button.parentElement;
        }
    },
});

  $(document).ready(function () {
    // product detail page
    const sct_rtl = $("#wrapwrap").hasClass("o_rtl");
    $("div#recommended_products_slider").owlCarousel({
      margin: 20,
      responsiveClass: true,
      items: 4,
      rtl: sct_rtl,
      autoPlay: 7000,
      stopOnHover: true,
      navigation: true,
      responsive: {
        0: { items: 1 },
        500: { items: 2 },
        700: { items: 3 },
        1000: { items: 4 },
        1500: { items: 4 },
      },
    });
    // recommended_products_slider end
    //product detail page cart fix
    if ($("div").hasClass("sct-add-to-cart-mob")) {
      $("#wrapwrap").addClass("sct-mobile-pro-detail-list");
    }
    if ($("#product_detail").length != 0) {
      $("body").addClass("sct-cst-pro-page");
    }
    // Product delivery location available checking start
    $(".checker").on("click", function () {
      var zip = $("input.value-zip").val();
      rpc("/shop/zipcode", {
        zip_code: zip,
      }).then(function (data) {
        if (data.status == true) {
          $(".get_status").removeClass("fail");
          $(".get_status").addClass("success");
          $("#fail_msg").addClass("o_hidden");
          $("#success_msg").removeClass("o_hidden");
          $("#blank_msg").addClass("o_hidden");
          $("input.value-zip").val(zip);
        }
        if (data.status == false) {
          $("input.value-zip").val(zip);
          $(".get_status").removeClass("success");
          $(".get_status").addClass("fail");
          $("#fail_msg").removeClass("o_hidden");
          $("#success_msg").addClass("o_hidden");
          $("#blank_msg").addClass("o_hidden");
        }
        if (data.zip == "notavailable") {
          $("input.value-zip").val(zip);
          $(".get_status").removeClass("success");
          $(".get_status").addClass("fail");
          $("#fail_msg").addClass("o_hidden");
          $("#success_msg").addClass("o_hidden");
          $("#blank_msg").removeClass("o_hidden");
        }
      });
    });
  });
