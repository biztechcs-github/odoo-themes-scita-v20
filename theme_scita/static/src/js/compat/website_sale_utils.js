/** @odoo-module **/
/**
 * Odoo 20's @website_sale/js/website_sale_utils plus the two helpers Scita still
 * uses that Odoo 20 removed: getClosestProductForm and animateClone (the
 * "fly to cart" image animation). Same behaviour as Odoo 19.
 */

import wSaleUtils from "@website_sale/js/website_sale_utils";

const $ = window.jQuery;

function getClosestProductForm(element) {
    return element.closest("form") ?? element.closest(".js_product")?.querySelector("form");
}

function animateClone($cart, $elem, offsetTop, offsetLeft) {
    if (!$cart || !$cart.length) {
        return Promise.resolve();
    }
    $cart.removeClass("d-none").find(".o_animate_blink").addClass("o_red_highlight o_shadow_animation")
        .delay(500).queue(function () {
            $(this).removeClass("o_shadow_animation").dequeue();
        })
        .delay(2000).queue(function () {
            $(this).removeClass("o_red_highlight").dequeue();
        });
    return new Promise((resolve) => {
        if (!$elem) {
            resolve();
            return;
        }
        const $img = $elem.find("img").eq(0);
        if (!$img.length) {
            resolve();
            return;
        }
        const $clone = $img.clone()
            .offset({ top: $img.offset().top, left: $img.offset().left })
            .removeClass()
            .addClass("o_website_sale_animate")
            .appendTo(document.body)
            .css({ width: $img.width(), height: $img.height() })
            .animate({
                top: $cart.offset().top + offsetTop,
                left: $cart.offset().left + offsetLeft,
                width: 75,
                height: 75,
            }, 500);
        $clone.animate({ width: 0, height: 0 }, function () {
            resolve();
            $(this).detach();
        });
    });
}

export default {
    ...wSaleUtils,
    getClosestProductForm,
    animateClone,
};
